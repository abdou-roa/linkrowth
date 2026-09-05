import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceArtifact, ExperienceIndex } from "./experience/types";
import {
  generateCandidates,
  shortlistMatches,
} from "./retrievalCandidates";

function artifact(
  id: string,
  extra: Partial<ExperienceArtifact> = {}
): ExperienceArtifact {
  return {
    id,
    sourceCandidateId: id,
    source: "local_git",
    repo: "linkrowth",
    implementationDate: "2026-09-05T00:00:00Z",
    title: id,
    domains: ["jobs"],
    stack: ["Postgres"],
    problem: "durable jobs",
    approach: "claim rows",
    tradeoff: "",
    claimableLine: `I built ${id}.`,
    confidence: "high",
    shareability: "public",
    paths: [],
    ...extra,
  };
}

function fixtureIndex(): ExperienceIndex {
  const publicArtifact = artifact("public");
  const lexicalArtifact = artifact("lexical");
  const privateArtifact = artifact("private", { shareability: "private" });
  return {
    indexedAt: "2026-09-05T00:00:00Z",
    schemaVersion: 3,
    embedding: { provider: "test", model: "fixture", dimensions: 2 },
    count: 3,
    items: [
      {
        id: privateArtifact.id,
        vector: [1, 0],
        situationVector: [1, 0],
        evidenceVector: [1, 0],
        artifact: privateArtifact,
      },
      {
        id: publicArtifact.id,
        vector: [0.9, 0.1],
        situationVector: [0.9, 0.1],
        evidenceVector: [1, 0],
        artifact: publicArtifact,
      },
      {
        id: lexicalArtifact.id,
        vector: [0, 1],
        situationVector: [0, 1],
        evidenceVector: [0, 1],
        artifact: lexicalArtifact,
      },
    ],
  };
}

describe("generateCandidates", () => {
  it("returns a serializable hybrid shortlist without selecting proof points", async () => {
    const index = fixtureIndex();
    const lexicalCandidate = {
      bm25Score: -4,
      artifact: index.items[2]!.artifact,
    };
    const privateCandidate = {
      bm25Score: -3,
      artifact: index.items[0]!.artifact,
    };
    const shortlist = await generateCandidates(
      { id: "post-1", text: "How do I make Postgres jobs durable?" },
      {
        loadIndex: () => index,
        embedQuery: async () => [1, 0],
        candidatePoolSize: 2,
        lexicalPoolSize: 2,
        lexicalSearch: () => ({
          eligible: [lexicalCandidate],
          entries: [
            { candidate: lexicalCandidate, rank: 0 },
            {
              candidate: privateCandidate,
              rank: 1,
              dropReason: "shareability",
            },
          ],
        }),
      }
    );

    assert.equal(shortlist.status, "ready");
    assert.deepEqual(
      shortlist.candidates
        .map((candidate) => candidate.artifact.id)
        .sort(),
      ["public", "lexical"]
        .sort()
    );
    assert.equal(
      shortlist.prefilteredCandidates.filter(
        (candidate) => candidate.artifactId === "private"
      ).length,
      1
    );
    assert.equal(shortlist.prefilteredCandidates[0]?.prefiltered, true);
    assert.equal(shortlistMatches(shortlist, { id: "post-1", text: "How do I make Postgres jobs durable?" }, index), true);
    assert.doesNotThrow(() => JSON.stringify(shortlist));
  });

  it("returns empty_query without loading or embedding", async () => {
    const shortlist = await generateCandidates(
      { text: "   " },
      {
        loadIndex: () => {
          throw new Error("must not load");
        },
        embedQuery: async () => {
          throw new Error("must not embed");
        },
      }
    );
    assert.equal(shortlist.status, "empty_query");
    assert.deepEqual(shortlist.candidates, []);
  });
});
