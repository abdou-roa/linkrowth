import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserContext } from "../../core/types";
import type { ExperienceIndex, IndexedExperience } from "./experience/types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "./experience/types";
import type {
  RetrievalTrace,
  RetrievalTraceSink,
} from "../persistence/retrievalTrace/types";
import { RETRIEVAL_TRACE_SCHEMA_VERSION } from "../persistence/retrievalTrace/types";
import {
  buildRetrievalQuery,
  retrieveContext,
} from "./retrieveContext";

/** Sink that records the last emitted trace for assertions. */
function capturingSink(): { sink: RetrievalTraceSink; last: () => RetrievalTrace } {
  let captured: RetrievalTrace | undefined;
  return {
    sink: {
      record(trace) {
        captured = trace;
      },
    },
    last: () => {
      assert.ok(captured, "expected a trace to be emitted");
      return captured;
    },
  };
}

const baseContext: UserContext = {
  niche: "AI engineering",
  positioning: "Builder",
  targetAudience: "Recruiters",
  proofPoints: ["Static proof point"],
};

function fixtureIndex(): ExperienceIndex {
  function makeItem(
    id: string,
    v: number[],
    artifact: ExperienceIndex["items"][number]["artifact"]
  ): IndexedExperience {
    return { id, vector: v, situationVector: v, evidenceVector: v, artifact };
  }

  return {
    indexedAt: "2026-08-27T00:00:00Z",
    schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
    embedding: { provider: "test", model: "fake", dimensions: 3 },
    count: 3,
    items: [
      makeItem("postgres", [1, 0, 0], {
        id: "postgres",
        sourceCandidateId: "postgres",
        source: "local_git",
        repo: "linkrowth",
        implementationDate: "2026-08-01T00:00:00Z",
        title: "Postgres suggestion jobs",
        domains: ["postgres", "jobs"],
        stack: ["Postgres"],
        problem: "Need durable suggestion jobs",
        approach: "Queued rows with claim semantics",
        tradeoff: "In-process worker for now",
        claimableLine: "I built a Postgres-backed suggestion job queue with claim semantics.",
        confidence: "high",
        shareability: "public",
        paths: ["db/migrations/0001_init.sql"],
      }),
      makeItem("private", [0.99, 0.01, 0], {
        id: "private",
        sourceCandidateId: "private",
        source: "local_git",
        repo: "client-x",
        implementationDate: "2026-08-01T00:00:00Z",
        title: "Client secret work",
        domains: ["postgres"],
        stack: ["Postgres"],
        problem: "NDA work",
        approach: "Cannot discuss",
        tradeoff: "",
        claimableLine: "I cannot discuss this client work.",
        confidence: "high",
        shareability: "private",
        paths: [],
      }),
      makeItem("extension", [0, 1, 0], {
        id: "extension",
        sourceCandidateId: "extension",
        source: "local_git",
        repo: "linkrowth",
        implementationDate: "2026-08-01T00:00:00Z",
        title: "Chrome badges",
        domains: ["extension"],
        stack: ["Chrome"],
        problem: "Feed triage visibility",
        approach: "MV3 badges",
        tradeoff: "",
        claimableLine: "I ship LinkedIn feed triage badges in a Chrome MV3 extension.",
        confidence: "high",
        shareability: "public",
        paths: ["extension/src/content/badge.css"],
      }),
    ],
  };
}

describe("buildRetrievalQuery", () => {
  it("includes author headline when present", () => {
    const query = buildRetrievalQuery({
      text: "We moved suggestion jobs to Postgres.",
      author: { headline: "Staff Engineer" },
    });
    assert.equal(query.headline, "Staff Engineer");
    assert.match(query.situationQuery, /Postgres/);
    assert.doesNotMatch(query.situationQuery, /Staff Engineer/);
  });
});

describe("retrieveContext", () => {
  it("merges relevant public claimable lines into proofPoints", async () => {
    const index = fixtureIndex();
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => index,
        // Query vector aligned with the postgres artifact.
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
      }
    );

    assert.ok(enriched.proofPoints?.includes("Static proof point"));
    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      )
    );
    assert.ok(
      !enriched.proofPoints?.includes("I cannot discuss this client work."),
      "private artifacts must not become proof points"
    );
  });

  it("returns base context unchanged when the index is missing", async () => {
    const enriched = await retrieveContext(
      { text: "Anything about agents" },
      baseContext,
      {
        loadIndex: () => null,
        embedQuery: async () => {
          throw new Error("should not embed when index is missing");
        },
      }
    );
    assert.deepEqual(enriched, baseContext);
  });

  it("returns base context when embedQuery fails", async () => {
    const enriched = await retrieveContext(
      { text: "Anything about agents" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => {
          throw new Error("embed provider down");
        },
      }
    );
    assert.deepEqual(enriched, baseContext);
  });

  it("skips hits below the score floor", async () => {
    const enriched = await retrieveContext(
      { text: "unrelated topic" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        // Far from both axes → low scores after cosine with [1,0,0]/[0,1,0].
        embedQuery: async () => [0, 0, 1],
        minScore: 0.3,
        k: 5,
      }
    );
    assert.deepEqual(enriched.proofPoints, ["Static proof point"]);
  });
});

describe("retrieveContext trace emission", () => {
  it("emits an injected trace with candidates and index meta", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        traceSink: sink,
      }
    );

    const trace = last();
    assert.equal(trace.outcome, "injected");
    assert.equal(trace.schemaVersion, RETRIEVAL_TRACE_SCHEMA_VERSION);
    assert.deepEqual(trace.params, {
      k: 3,
      minScore: 0.3,
      strategy: "single",
      candidatePoolSize: 12,
      queryConstruction: {
        tier: "a",
        fallback: false,
        rawLength: "How do you run durable suggestion jobs without Kafka?".length,
        constructedLength: "How do you run durable suggestion jobs without Kafka?".length,
      },
    });
    assert.deepEqual(trace.index, {
      provider: "test",
      model: "fake",
      dimensions: 3,
      indexedAt: "2026-08-27T00:00:00Z",
      count: 3,
      schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
    });
    assert.deepEqual(trace.injectedProofPoints, [
      "I built a Postgres-backed suggestion job queue with claim semantics.",
    ]);

    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.selected, "postgres artifact should be selected");
    const priv = trace.candidates.find((c) => c.artifactId === "private");
    assert.equal(
      priv,
      undefined,
      "Phase 1: private artifacts are prefiltered out of the candidate pool"
    );
    assert.equal(trace.query.text, "How do you run durable suggestion jobs without Kafka?");
    assert.equal(trace.query.headline, undefined);
  });

  it("avoids candidate starvation when non-injectable rows outrank a public hit", async () => {
    function makeItem(
      id: string,
      v: number[],
      artifact: ExperienceIndex["items"][number]["artifact"]
    ): IndexedExperience {
      return { id, vector: v, situationVector: v, evidenceVector: v, artifact };
    }

    const starvationIndex: ExperienceIndex = {
      indexedAt: "2026-08-27T00:00:00Z",
      schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
      embedding: { provider: "test", model: "fake", dimensions: 3 },
      count: 3,
      items: [
        makeItem("private-top", [1, 0, 0], {
          id: "private-top",
          sourceCandidateId: "private-top",
          source: "local_git",
          repo: "client-x",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Private top hit",
          domains: ["postgres"],
          stack: ["Postgres"],
          problem: "NDA",
          approach: "hidden",
          tradeoff: "",
          claimableLine: "I cannot discuss this.",
          confidence: "high",
          shareability: "private",
          paths: [],
        }),
        makeItem("low-second", [0.99, 0.01, 0], {
          id: "low-second",
          sourceCandidateId: "low-second",
          source: "local_git",
          repo: "linkrowth",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Low confidence near miss",
          domains: ["postgres"],
          stack: ["Postgres"],
          problem: "Jobs",
          approach: "Queue",
          tradeoff: "",
          claimableLine: "I almost claimed this.",
          confidence: "low",
          shareability: "public",
          paths: [],
        }),
        makeItem("public-third", [0.9, 0.1, 0], {
          id: "public-third",
          sourceCandidateId: "public-third",
          source: "local_git",
          repo: "linkrowth",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Public durable jobs",
          domains: ["postgres", "jobs"],
          stack: ["Postgres"],
          problem: "Need durable suggestion jobs",
          approach: "Queued rows",
          tradeoff: "",
          claimableLine: "I built durable suggestion jobs.",
          confidence: "high",
          shareability: "public",
          paths: [],
        }),
      ],
    };

    const { sink, last } = capturingSink();
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => starvationIndex,
        embedQuery: async () => [1, 0, 0],
        k: 1,
        candidatePoolSize: 1,
        minScore: 0.3,
        strategy: "single",
        traceSink: sink,
      }
    );

    assert.ok(
      enriched.proofPoints?.includes("I built durable suggestion jobs."),
      "public third-ranked artifact must survive after prefilter"
    );
    const trace = last();
    assert.equal(trace.params.candidatePoolSize, 1);
    assert.deepEqual(
      trace.candidates.map((c) => c.artifactId),
      ["public-third"]
    );
    assert.ok(trace.candidates[0]?.selected);
  });

  it("emits no_survivors when everything is filtered out", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "unrelated topic" }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => [0, 0, 1],
      minScore: 0.3,
      k: 5,
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "no_survivors");
    assert.deepEqual(trace.injectedProofPoints, []);
    assert.ok(trace.candidates.length > 0, "candidates should still be recorded");
    assert.ok(trace.candidates.every((c) => !c.selected));
  });

  it("emits no_index when the index is missing", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "anything" }, baseContext, {
      loadIndex: () => null,
      embedQuery: async () => {
        throw new Error("should not embed");
      },
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "no_index");
    assert.equal(trace.index, null);
  });

  it("emits embed_failed with index meta when embedding throws", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "anything" }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => {
        throw new Error("provider down");
      },
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "embed_failed");
    assert.ok(trace.index, "index meta should be present before embed failure");
    assert.deepEqual(trace.candidates, []);
  });

  it("embeds the situation query and records headline separately", async () => {
    const { sink, last } = capturingSink();
    let embedded = "";
    await retrieveContext(
      {
        text: "How do you run durable suggestion jobs without Kafka? 🔥\n\nThoughts?\n#engineering",
        author: { headline: "VP of Engineering | ex-Stripe" },
      },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async (text) => {
          embedded = text;
          return [1, 0, 0];
        },
        k: 3,
        minScore: 0.3,
        traceSink: sink,
      }
    );

    assert.equal(embedded, "How do you run durable suggestion jobs without Kafka?");
    assert.doesNotMatch(embedded, /Stripe/);
    const trace = last();
    assert.equal(trace.query.headline, "VP of Engineering | ex-Stripe");
    assert.equal(trace.query.text, embedded);
    assert.deepEqual(trace.params.queryConstruction, {
      tier: "a",
      fallback: false,
      rawLength:
        "How do you run durable suggestion jobs without Kafka? 🔥\n\nThoughts?\n#engineering".length,
      constructedLength: embedded.length,
    });
  });

  it("emits empty_query when there is nothing to search", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "   " }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => [1, 0, 0],
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "empty_query");
    assert.equal(trace.index, null);
  });

  it("never lets a throwing sink break retrieval", async () => {
    const throwingSink: RetrievalTraceSink = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        traceSink: throwingSink,
      }
    );
    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      ),
      "retrieval result must be unaffected by sink failure"
    );
  });
});

describe("retrieveContext split strategy", () => {
  it("injects on situation cosine and records strategy=split on the trace", async () => {
    const { sink, last } = capturingSink();
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        strategy: "split",
        traceSink: sink,
      }
    );

    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      )
    );

    const trace = last();
    assert.equal(trace.outcome, "injected");
    assert.equal(trace.params.strategy, "split");
    assert.equal(trace.params.candidatePoolSize, 12);

    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.selected);
    assert.equal(postgres?.situationScore, postgres?.score);
  });

  it("annotates evidenceScore on candidates when analysis is provided", async () => {
    const { sink, last } = capturingSink();
    let embedCallCount = 0;

    await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        // First call: situation query → near [1,0,0]; second call: evidence query → [0,0,1]
        embedQuery: async () => {
          embedCallCount += 1;
          return embedCallCount === 1 ? [1, 0, 0] : [0, 0, 1];
        },
        k: 3,
        minScore: 0.3,
        strategy: "split",
        analysis: {
          category: "technical",
          coreThesis: "Jobs are being lost silently.",
          tone: "analytical",
          authorProfile: { isTechnical: true, seniority: "ic" },
          postQuestions: [
            { text: "How to add durability?", decision: "answer", reason: "direct ask" },
          ],
          unspokenTradeoffs: [],
          riskFlags: [],
          pivotStrategy: { acknowledgedPoint: "", insightDirection: "Suggest Redis Streams." },
          responseParameters: { technicalDepth: "high", suggestedLength: "standard" },
        },
        traceSink: sink,
      }
    );

    const trace = last();
    assert.equal(embedCallCount, 2, "should embed both situation and evidence queries");
    assert.ok(trace.query.evidenceText, "evidence query text should be recorded");

    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.evidenceScore !== undefined, "evidenceScore should be annotated");
  });

  it("falls back to static context when index schema is incompatible", async () => {
    const { sink, last } = capturingSink();
    const incompatibleIndex: ExperienceIndex = {
      ...fixtureIndex(),
      schemaVersion: 1,
    };

    const enriched = await retrieveContext(
      { text: "Background jobs dropping under load." },
      baseContext,
      {
        loadIndex: () => incompatibleIndex,
        embedQuery: async () => [1, 0, 0],
        traceSink: sink,
      }
    );

    assert.deepEqual(enriched, baseContext);
    const trace = last();
    assert.equal(trace.outcome, "no_index");
  });

  it("single strategy is unaffected — trace has no situationScore", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        strategy: "single",
        traceSink: sink,
      }
    );

    const trace = last();
    assert.equal(trace.params.strategy, "single");
    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.selected);
    assert.equal(postgres?.situationScore, undefined);
    assert.equal(postgres?.evidenceScore, undefined);
  });
});

describe("retrieveContext hybrid strategy", () => {
  it("fuses semantic + lexical ranks and records hybrid params on trace", async () => {
    const { sink, last } = capturingSink();
    const enriched = await retrieveContext(
      { text: "How do you run durable Postgres suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        lexicalSearch: () => [
          {
            bm25Score: -5.0,
            artifact: fixtureIndex().items[0]!.artifact,
          },
        ],
        k: 3,
        minScore: 0.3,
        strategy: "hybrid",
        rrfC: 60,
        traceSink: sink,
      }
    );

    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      )
    );

    const trace = last();
    assert.equal(trace.schemaVersion, RETRIEVAL_TRACE_SCHEMA_VERSION);
    assert.equal(trace.params.strategy, "hybrid");
    assert.equal(trace.params.minScore, 0);
    assert.equal(trace.params.rrfC, 60);
    assert.equal(trace.params.candidatePoolSize, 12);
    assert.equal(trace.params.semanticPoolSize, 12);
    assert.equal(trace.params.lexicalPoolSize, 12);

    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.selected);
    assert.ok(postgres?.rrfScore !== undefined);
    assert.ok(postgres?.situationScore !== undefined);
    assert.equal(postgres?.lexicalRank, 1);
    assert.equal(postgres?.bm25Score, -5.0);
  });

  it("falls back to situation-only when lexical search throws", async () => {
    const { sink, last } = capturingSink();
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        lexicalSearch: () => {
          throw new Error("FTS5 unavailable");
        },
        k: 3,
        strategy: "hybrid",
        traceSink: sink,
      }
    );

    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      )
    );
    const trace = last();
    assert.equal(trace.outcome, "injected");
    assert.equal(trace.params.strategy, "hybrid");
  });
});
