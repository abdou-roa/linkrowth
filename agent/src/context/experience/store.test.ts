import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ExperienceArtifact, ExperienceIndex } from "./types";
import { loadIndex, rankIndex } from "./store";
import { cosineSimilarity, retrievalText } from "./vector";

const artifact = (
  id: string,
  line: string,
  extra: Partial<ExperienceArtifact> = {}
): ExperienceArtifact => ({
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

function encodeVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

/** Test-only writer matching distill's experience-index.db schema. */
function writeFixtureIndex(dbPath: string, index: ExperienceIndex): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        indexed_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        artifact_json TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO index_meta (id, indexed_at, provider, model, dimensions, count)
       VALUES (1, @indexedAt, @provider, @model, @dimensions, @count)`
    ).run({
      indexedAt: index.indexedAt,
      provider: index.embedding.provider,
      model: index.embedding.model,
      dimensions: index.embedding.dimensions,
      count: index.count,
    });
    const insert = db.prepare(
      `INSERT INTO experiences (id, vector, artifact_json) VALUES (@id, @vector, @artifactJson)`
    );
    for (const item of index.items) {
      insert.run({
        id: item.id,
        vector: encodeVector(item.vector),
        artifactJson: JSON.stringify(item.artifact),
      });
    }
  } finally {
    db.close();
  }
}

describe("vector helpers", () => {
  it("builds retrieval text from claimable fields", () => {
    const text = retrievalText(
      artifact("exp_1", "I ship comments through a stable engage() signature.", {
        domains: ["linkedin-comments"],
        stack: ["Node"],
        problem: "CLI and extension both needed the same brain.",
        approach: "One engage(post, context) function.",
      })
    );
    assert.match(text, /engage\(\)/);
    assert.match(text, /linkedin-comments/);
  });

  it("returns 0 cosine for mismatched dimensions", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
    assert.equal(cosineSimilarity([], [1]), 0);
  });
});

describe("experience index store", () => {
  it("loads and ranks from a SQLite fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      writeFixtureIndex(dbPath, {
        indexedAt: "2026-08-27T00:00:00Z",
        embedding: { provider: "test", model: "fake", dimensions: 3 },
        count: 2,
        items: [
          {
            id: "near",
            vector: [1, 0, 0],
            artifact: artifact("near", "postgres job queue"),
          },
          {
            id: "far",
            vector: [0, 1, 0],
            artifact: artifact("far", "chrome extension badges"),
          },
        ],
      });

      const loaded = loadIndex(dbPath);
      assert.ok(loaded);
      assert.equal(loaded.count, 2);
      assert.equal(loaded.embedding.provider, "test");
      assert.equal(loaded.items.length, 2);

      const hits = rankIndex(loaded, [1, 0, 0], 1);
      assert.equal(hits[0]?.artifact.id, "near");
      assert.ok((hits[0]?.score ?? 0) > 0.99);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the sqlite index file is missing", () => {
    assert.equal(loadIndex(join(tmpdir(), "does-not-exist-experience-index.db")), null);
  });
});
