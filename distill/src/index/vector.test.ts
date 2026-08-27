import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceArtifact } from "../types";
import { buildIndex, rankIndex } from "./store";
import { cosineSimilarity, retrievalText } from "./vector";

const artifact = (id: string, line: string, extra: Partial<ExperienceArtifact> = {}): ExperienceArtifact => ({
  id,
  sourceCandidateId: id,
  source: "local_git",
  repo: "linkrowth",
  implementationDate: "2026-08-25T00:00:00Z",
  title: line,
  domains: ["agents"],
  stack: ["TypeScript"],
  problem: "p",
  approach: "a",
  tradeoff: "",
  claimableLine: line,
  confidence: "high",
  shareability: "public",
  paths: ["agent/src/core/engage.ts"],
  ...extra,
});

describe("vector helpers", () => {
  it("builds retrieval text from claimable fields and paths, not raw bodies", () => {
    const text = retrievalText(
      artifact("exp_1", "I ship comments through a stable engage() signature.", {
        domains: ["linkedin-comments"],
        stack: ["Node"],
        problem: "CLI and extension both needed the same brain.",
        approach: "One engage(post, context) function.",
        paths: ["agent/src/core/engage.ts", "package-lock.json"],
      })
    );
    assert.match(text, /engage\(\)/);
    assert.match(text, /linkedin-comments/);
    assert.match(text, /agent\/src\/core\/engage.ts/);
    assert.doesNotMatch(text, /RawExperienceCandidate/);
  });

  it("ranks by cosine similarity and returns top-k", async () => {
    const index = await buildIndex(
      [
        artifact("near", "postgres job queue"),
        artifact("far", "chrome extension badges"),
        artifact("mid", "express gateway"),
      ],
      async (texts) =>
        texts.map((t) => {
          if (t.includes("postgres")) return [1, 0, 0];
          if (t.includes("express")) return [0.6, 0.4, 0];
          return [0, 1, 0];
        }),
      { provider: "test", model: "fake", dimensions: 3 }
    );

    assert.equal(index.count, 3);
    assert.equal(index.embedding.dimensions, 3);

    const hits = rankIndex(index, [1, 0, 0], 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.artifact.id, "near");
    assert.equal(hits[1]?.artifact.id, "mid");
    assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 1));
  });

  it("returns 0 cosine for mismatched dimensions", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
    assert.equal(cosineSimilarity([], [1]), 0);
  });
});
