import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Post, UserContext } from "../../core/types";
import type { AnalysisArtifact } from "../../steps/types";
import {
  CANDIDATE_SHORTLIST_VERSION,
  fingerprintPost,
  indexFingerprint,
  type CandidateShortlist,
} from "../retrievalCandidates";
import {
  AnalysisAwareRetrievalError,
  compareAnalysisAwareCandidates,
  selectForAnalysis,
} from "./rerank";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  FusedCandidate,
} from "./types";

const post: Post = {
  id: "post-1",
  text: "Postgres background jobs need durable retries.",
};
const analysis: AnalysisArtifact = {
  category: "technical",
  coreThesis: "Durability depends on explicit acknowledgement.",
  tone: "analytical",
  authorProfile: { isTechnical: true, seniority: "ic" },
  postQuestions: [],
  unspokenTradeoffs: ["Operational ownership"],
  riskFlags: [],
  pivotStrategy: {
    acknowledgedPoint: "Retries are hard.",
    insightDirection: "Use claimed rows with explicit acknowledgements.",
  },
  responseParameters: {
    technicalDepth: "high",
    suggestedLength: "standard",
  },
};
const baseContext: UserContext = {
  niche: "engineering",
  positioning: "operator",
  targetAudience: "technical leaders",
  proofPoints: ["Existing proof."],
};

function artifact(id: string, line: string, stack: string[]): ExperienceArtifact {
  return {
    id,
    sourceCandidateId: id,
    source: "local_git",
    repo: "linkrowth",
    implementationDate: "2026-09-05T00:00:00Z",
    title: id,
    domains: ["jobs"],
    stack,
    problem: "durability",
    approach: "claim rows",
    tradeoff: "ownership",
    claimableLine: line,
    confidence: "high",
    shareability: "public",
    paths: [],
  };
}

function fixtures(): {
  index: ExperienceIndex;
  shortlist: CandidateShortlist;
} {
  const high = artifact("high-evidence", "I built durable claimed jobs.", [
    "Postgres",
  ]);
  const low = artifact("low-evidence", "I built a generic worker.", ["Redis"]);
  const index: ExperienceIndex = {
    indexedAt: "2026-09-05T00:00:00Z",
    schemaVersion: 3,
    embedding: { provider: "test", model: "fixture", dimensions: 2 },
    count: 2,
    items: [
      {
        id: high.id,
        vector: [1, 0],
        situationVector: [1, 0],
        evidenceVector: [1, 0],
        artifact: high,
      },
      {
        id: low.id,
        vector: [1, 0],
        situationVector: [1, 0],
        evidenceVector: [0, 1],
        artifact: low,
      },
    ],
  };
  const candidates: FusedCandidate[] = [
    {
      artifact: low,
      rrfScore: 0.5,
      semanticRank: 1,
      situationScore: 0.9,
    },
    {
      artifact: high,
      rrfScore: 0.1,
      semanticRank: 2,
      situationScore: 0.8,
    },
  ];
  return {
    index,
    shortlist: {
      version: CANDIDATE_SHORTLIST_VERSION,
      status: "ready",
      postFingerprint: fingerprintPost(post),
      query: {
        situationQuery: post.text,
        headline: "",
        tier: "a",
        fallback: false,
        rawLength: post.text.length,
        constructedLength: post.text.length,
      },
      index: indexFingerprint(index),
      candidates,
      prefilteredCandidates: [],
      params: { strategy: "hybrid" },
      timings: { candidateGenerationMs: 2 },
    },
  };
}

describe("selectForAnalysis", () => {
  it("orders by evidence before RRF and injects only after analysis", async () => {
    const { index, shortlist } = fixtures();
    const result = await selectForAnalysis(
      post,
      analysis,
      {
        status: "answered",
        question: "Which database?",
        answer: "Postgres",
      },
      shortlist,
      baseContext,
      {
        loadIndex: () => index,
        embedQuery: async () => [1, 0],
        minEvidenceScore: 0.1,
        k: 1,
      }
    );

    assert.deepEqual(result.selectedArtifactIds, ["high-evidence"]);
    assert.deepEqual(result.context.proofPoints, [
      "Existing proof.",
      "I built durable claimed jobs.",
    ]);
    assert.equal(result.trace.outcome, "injected");
    assert.equal(result.trace.candidates[0]?.artifactId, "high-evidence");
    assert.equal(result.trace.candidates[0]?.signals?.exactOverlapCount, 1);
    assert.match(result.trace.query.evidenceText ?? "", /Postgres/);
    assert.equal(
      (result.trace.params.evidenceQueryProvenance as {
        hasClarificationAnswer: boolean;
      }).hasClarificationAnswer,
      true
    );
  });

  it("explicitly abstains when every candidate misses the evidence floor", async () => {
    const { index, shortlist } = fixtures();
    const result = await selectForAnalysis(
      post,
      analysis,
      undefined,
      shortlist,
      baseContext,
      {
        loadIndex: () => index,
        embedQuery: async () => [0, -1],
        minEvidenceScore: 0.1,
      }
    );

    assert.equal(result.trace.outcome, "abstained");
    assert.equal(result.abstentionReason, "no_evidence_match");
    assert.strictEqual(result.context, baseContext);
    assert.deepEqual(result.selectedArtifactIds, []);
  });

  it("rejects a stale shortlist before evidence scoring", async () => {
    const { index, shortlist } = fixtures();
    await assert.rejects(
      () =>
        selectForAnalysis(
          { ...post, text: "changed" },
          analysis,
          undefined,
          shortlist,
          baseContext,
          { loadIndex: () => index, embedQuery: async () => [1, 0] }
        ),
      (error: unknown) =>
        error instanceof AnalysisAwareRetrievalError &&
        error.reason === "stale_shortlist"
    );
  });
});

describe("compareAnalysisAwareCandidates", () => {
  it("uses artifact id as the final deterministic tie breaker", () => {
    const { shortlist } = fixtures();
    const [left, right] = shortlist.candidates;
    assert.ok(left && right);
    const result = compareAnalysisAwareCandidates(
      {
        candidate: { ...left, rrfScore: 0.5 },
        evidenceScore: 1,
        exactOverlapTerms: [],
      },
      {
        candidate: { ...right, rrfScore: 0.5 },
        evidenceScore: 1,
        exactOverlapTerms: [],
      }
    );
    assert.ok(result > 0);
  });
});
