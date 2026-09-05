import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ExperienceArtifact } from "../types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "../types";
import {
  buildIndex,
  inspectIndex,
  loadIndex,
  rankByEvidence,
  rankBySituation,
  rankIndex,
  saveIndex,
} from "./store";
import { cosineSimilarity, evidenceText, retrievalText, situationText } from "./vector";

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
  it("retrievalText: builds combined text from all semantic fields including paths", () => {
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

  it("situationText: includes title, domains, stack, problem — excludes approach and paths", () => {
    const text = situationText(
      artifact("exp_2", "Background job durability", {
        domains: ["background-jobs"],
        stack: ["Node", "Redis"],
        problem: "Jobs were silently lost under load.",
        approach: "Replaced BullMQ with Redis Streams.",
        paths: ["src/workers/queue.ts"],
      })
    );
    assert.match(text, /Background job durability/);
    assert.match(text, /background-jobs/);
    assert.match(text, /Node/);
    assert.match(text, /Jobs were silently lost/);
    assert.doesNotMatch(text, /Redis Streams/); // approach — excluded
    assert.doesNotMatch(text, /queue\.ts/);     // paths — excluded
  });

  it("evidenceText: includes approach, tradeoff, claimableLine — excludes title and paths", () => {
    const text = evidenceText(
      artifact("exp_3", "I replaced a lossy queue with Redis Streams.", {
        approach: "Replaced BullMQ with Redis Streams for durability guarantees.",
        tradeoff: "Higher operational complexity but zero message loss.",
        paths: ["src/workers/queue.ts"],
      })
    );
    assert.match(text, /Redis Streams for durability/);
    assert.match(text, /Higher operational complexity/);
    assert.match(text, /I replaced a lossy queue/);
    assert.doesNotMatch(text, /Background job/); // title — excluded
    assert.doesNotMatch(text, /queue\.ts/);       // paths — excluded
  });

  it("situationText: excludes empty fields", () => {
    const text = situationText(artifact("exp_4", "Test", { domains: [], stack: [], problem: "" }));
    assert.equal(text, "Test");
  });

  it("evidenceText: excludes empty fields", () => {
    const text = evidenceText(artifact("exp_5", "I did something.", { approach: "", tradeoff: "" }));
    assert.equal(text, "I did something.");
  });

  it("ranks by cosine similarity and returns top-k (combined vector)", async () => {
    const index = await buildIndex(
      [
        artifact("near", "postgres job queue"),
        artifact("far", "chrome extension badges"),
        artifact("mid", "express gateway"),
      ],
      async (texts) =>
        // Interleaved: combined, situation, evidence per artifact
        texts.map((t) => {
          if (t.includes("postgres")) return [1, 0, 0];
          if (t.includes("express")) return [0.6, 0.4, 0];
          return [0, 1, 0];
        }),
      { provider: "test", model: "fake", dimensions: 3 }
    );

    assert.equal(index.count, 3);
    assert.equal(index.embedding.dimensions, 3);
    assert.equal(index.schemaVersion, EXPERIENCE_INDEX_SCHEMA_VERSION);

    const hits = rankIndex(index, [1, 0, 0], 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.artifact.id, "near");
    assert.equal(hits[1]?.artifact.id, "mid");
    assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 1));
  });

  it("buildIndex embeds three texts per artifact (combined, situation, evidence)", async () => {
    const embedded: string[] = [];
    const index = await buildIndex(
      [artifact("a1", "title A", { problem: "prob A", approach: "appr A" })],
      async (texts) => {
        embedded.push(...texts);
        return texts.map(() => [1, 0, 0]);
      },
      { provider: "test", model: "fake", dimensions: 3 }
    );
    // 3 texts per artifact
    assert.equal(embedded.length, 3);
    // first = combined (includes approach)
    assert.match(embedded[0]!, /appr A/);
    // second = situation (no approach)
    assert.doesNotMatch(embedded[1]!, /appr A/);
    assert.match(embedded[1]!, /prob A/);
    // third = evidence (no problem)
    assert.doesNotMatch(embedded[2]!, /prob A/);
    assert.match(embedded[2]!, /appr A/);

    assert.equal(index.items[0]!.id, "a1");
  });

  it("rankBySituation ranks by situationVector, not combined vector", async () => {
    // Situation vectors are [1,0] for "near" and [0,1] for "far".
    // Combined vectors are [0,1] for "near" and [1,0] for "far" (reversed) to ensure
    // we're actually using situationVector and not combined.
    const index = await buildIndex(
      [artifact("near_situation", "near"), artifact("far_situation", "far")],
      async (texts) =>
        texts.map((t, i) => {
          // combined: inverted; situation: correct; evidence: orthogonal
          if (i % 3 === 0) return t.includes("near") ? [0, 1] : [1, 0]; // combined — reversed
          if (i % 3 === 1) return t.includes("near") ? [1, 0] : [0, 1]; // situation — correct
          return [0, 0];                                                   // evidence
        }),
      { provider: "test", model: "fake", dimensions: 2 }
    );

    const hits = rankBySituation(index, [1, 0], 2);
    assert.equal(hits[0]?.artifact.id, "near_situation");
    assert.ok((hits[0]?.score ?? 0) > 0.9);
  });

  it("rankByEvidence ranks by evidenceVector, not combined vector", async () => {
    const index = await buildIndex(
      [artifact("near_evidence", "near"), artifact("far_evidence", "far")],
      async (texts) =>
        texts.map((t, i) => {
          if (i % 3 === 0) return t.includes("near") ? [0, 1] : [1, 0];
          if (i % 3 === 1) return [0, 0];
          return t.includes("near") ? [1, 0] : [0, 1];
        }),
      { provider: "test", model: "fake", dimensions: 2 }
    );

    const hits = rankByEvidence(index, [1, 0], 2);
    assert.equal(hits[0]?.artifact.id, "near_evidence");
    assert.ok((hits[0]?.score ?? 0) > 0.9);
    assert.equal(rankIndex(index, [1, 0], 1)[0]?.artifact.id, "far_evidence");
  });

  it("returns 0 cosine for mismatched dimensions", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
    assert.equal(cosineSimilarity([], [1]), 0);
  });

  it("persists and reloads the v2 index from SQLite with all three vectors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-index-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const index = await buildIndex(
        [
          artifact("near", "postgres job queue"),
          artifact("far", "chrome extension badges"),
        ],
        async (texts) =>
          // Interleaved: positions 0,1,2 = near (combined/situation/evidence);
          //              positions 3,4,5 = far (combined/situation/evidence)
          texts.map((_, i) => {
            const artifactIdx = Math.floor(i / 3);
            const slot = i % 3;
            if (artifactIdx === 0) {
              // near: combined=[1,0,0], situation=[0,1,0], evidence=[0,0,1]
              if (slot === 0) return [1, 0, 0];
              if (slot === 1) return [0, 1, 0];
              return [0, 0, 1];
            } else {
              // far: combined=[0,1,0], situation=[0,0,1], evidence=[1,0,0]
              if (slot === 0) return [0, 1, 0];
              if (slot === 1) return [0, 0, 1];
              return [1, 0, 0];
            }
          }),
        { provider: "test", model: "fake", dimensions: 3 }
      );

      saveIndex(dbPath, index);
      const loaded = loadIndex(dbPath);
      assert.ok(loaded);
      assert.deepEqual(inspectIndex(dbPath), { status: "current", count: 2 });
      assert.equal(loaded.count, 2);
      assert.equal(loaded.schemaVersion, EXPERIENCE_INDEX_SCHEMA_VERSION);
      assert.equal(loaded.items.length, 2);

      const near = loaded.items.find((item) => item.id === "near");
      assert.ok(near);
      assert.deepEqual(near.vector, [1, 0, 0]);
      assert.deepEqual(near.situationVector, [0, 1, 0]);
      assert.deepEqual(near.evidenceVector, [0, 0, 1]);
      assert.equal(near.artifact.claimableLine, "postgres job queue");

      // rankIndex uses combined vector → near wins
      const hits = rankIndex(loaded, [1, 0, 0], 1);
      assert.equal(hits[0]?.artifact.id, "near");

      // rankBySituation uses situation vector → near wins [0,1,0] for query [0,1,0]
      const situationHits = rankBySituation(loaded, [0, 1, 0], 1);
      assert.equal(situationHits[0]?.artifact.id, "near");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the sqlite index file is missing", () => {
    assert.equal(loadIndex(join(tmpdir(), "does-not-exist-experience-index.db")), null);
  });

  it("preserves the previous index when a rebuild fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-index-atomic-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const valid = await buildIndex(
        [artifact("existing", "existing claim")],
        async (texts) => texts.map(() => [1, 0]),
        { provider: "test", model: "fake", dimensions: 2 }
      );
      saveIndex(dbPath, valid);

      const duplicate = {
        ...valid,
        count: 2,
        items: [valid.items[0]!, { ...valid.items[0]! }],
      };
      assert.throws(() => saveIndex(dbPath, duplicate), /UNIQUE constraint failed/);

      const loaded = loadIndex(dbPath);
      assert.ok(loaded);
      assert.equal(loaded.count, 1);
      assert.deepEqual(loaded.items.map((item) => item.id), ["existing"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
