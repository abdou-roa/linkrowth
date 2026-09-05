import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { ExperienceArtifact, ExperienceIndex, IndexedExperience } from "./types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "./types";
import {
  buildFts5Query,
  evidenceScore,
  inspectIndex,
  LexicalSearchError,
  loadIndex,
  rankByLexical,
  rankBySituation,
  rankIndex,
} from "./store";
import { cosineSimilarity, evidenceText, lexicalFields, retrievalText, situationText } from "./vector";

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

/** Write a v3 fixture index with FTS5 table directly to SQLite. */
function writeFixtureIndexV3(dbPath: string, index: ExperienceIndex): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        indexed_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        count INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 3
      );
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        situation_vector BLOB NOT NULL,
        evidence_vector BLOB NOT NULL,
        artifact_json TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(
        id UNINDEXED,
        title,
        domains,
        stack,
        problem,
        approach,
        paths,
        tokenize = 'unicode61'
      );
    `);
    db.prepare(
      `INSERT INTO index_meta (id, indexed_at, provider, model, dimensions, count, schema_version)
       VALUES (1, @indexedAt, @provider, @model, @dimensions, @count, @schemaVersion)`
    ).run({
      indexedAt: index.indexedAt,
      provider: index.embedding.provider,
      model: index.embedding.model,
      dimensions: index.embedding.dimensions,
      count: index.count,
      schemaVersion: index.schemaVersion,
    });
    const insert = db.prepare(
      `INSERT INTO experiences (id, vector, situation_vector, evidence_vector, artifact_json)
       VALUES (@id, @vector, @situationVector, @evidenceVector, @artifactJson)`
    );
    const insertFts = db.prepare(
      `INSERT INTO experiences_fts (id, title, domains, stack, problem, approach, paths)
       VALUES (@id, @title, @domains, @stack, @problem, @approach, @paths)`
    );
    for (const item of index.items) {
      insert.run({
        id: item.id,
        vector: encodeVector(item.vector),
        situationVector: encodeVector(item.situationVector),
        evidenceVector: encodeVector(item.evidenceVector),
        artifactJson: JSON.stringify(item.artifact),
      });
      const lex = lexicalFields(item.artifact);
      insertFts.run({ id: item.id, ...lex });
    }
  } finally {
    db.close();
  }
}

/** Write a v2 fixture index directly to SQLite (mirrors distill's saveIndex v2 format). */
function writeFixtureIndexV2(dbPath: string, index: ExperienceIndex): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS index_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        indexed_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        count INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 2
      );
      CREATE TABLE IF NOT EXISTS experiences (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        situation_vector BLOB NOT NULL,
        evidence_vector BLOB NOT NULL,
        artifact_json TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO index_meta (id, indexed_at, provider, model, dimensions, count, schema_version)
       VALUES (1, @indexedAt, @provider, @model, @dimensions, @count, @schemaVersion)`
    ).run({
      indexedAt: index.indexedAt,
      provider: index.embedding.provider,
      model: index.embedding.model,
      dimensions: index.embedding.dimensions,
      count: index.count,
      schemaVersion: index.schemaVersion,
    });
    const insert = db.prepare(
      `INSERT INTO experiences (id, vector, situation_vector, evidence_vector, artifact_json)
       VALUES (@id, @vector, @situationVector, @evidenceVector, @artifactJson)`
    );
    for (const item of index.items) {
      insert.run({
        id: item.id,
        vector: encodeVector(item.vector),
        situationVector: encodeVector(item.situationVector),
        evidenceVector: encodeVector(item.evidenceVector),
        artifactJson: JSON.stringify(item.artifact),
      });
    }
  } finally {
    db.close();
  }
}

/** Write a v1 fixture index (no schema_version column, single vector). */
function writeFixtureIndexV1(dbPath: string, items: IndexedExperience[]): void {
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
       VALUES (1, '2026-08-01T00:00:00Z', 'test', 'fake-v1', 3, @count)`
    ).run({ count: items.length });
    const insert = db.prepare(
      `INSERT INTO experiences (id, vector, artifact_json) VALUES (@id, @vector, @artifactJson)`
    );
    for (const item of items) {
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

function makeV2Index(near: IndexedExperience, far: IndexedExperience): ExperienceIndex {
  return {
    indexedAt: "2026-08-27T00:00:00Z",
    schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
    embedding: { provider: "test", model: "fake", dimensions: 3 },
    count: 2,
    items: [near, far],
  };
}

describe("vector helpers", () => {
  it("retrievalText: builds combined text from claimable fields", () => {
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

  it("situationText: includes title/domains/stack/problem, excludes approach", () => {
    const text = situationText(
      artifact("exp_2", "Job durability", {
        problem: "Jobs were lost.",
        approach: "Used Redis Streams.",
      })
    );
    assert.match(text, /Job durability/);
    assert.match(text, /Jobs were lost/);
    assert.doesNotMatch(text, /Redis Streams/);
  });

  it("evidenceText: includes approach/tradeoff/claimableLine, excludes problem", () => {
    const text = evidenceText(
      artifact("exp_3", "I built X.", {
        problem: "The system was slow.",
        approach: "Added connection pooling.",
        tradeoff: "Slightly more memory.",
      })
    );
    assert.match(text, /connection pooling/);
    assert.match(text, /more memory/);
    assert.doesNotMatch(text, /system was slow/);
  });

  it("returns 0 cosine for mismatched dimensions", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
    assert.equal(cosineSimilarity([], [1]), 0);
  });
});

describe("experience index store (v3)", () => {
  it("loads v2 index with all three vectors", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const near: IndexedExperience = {
        id: "near",
        vector: [1, 0, 0],
        situationVector: [0, 1, 0],
        evidenceVector: [0, 0, 1],
        artifact: artifact("near", "postgres job queue"),
      };
      const far: IndexedExperience = {
        id: "far",
        vector: [0, 1, 0],
        situationVector: [0, 0, 1],
        evidenceVector: [1, 0, 0],
        artifact: artifact("far", "chrome extension badges"),
      };

      writeFixtureIndexV2(dbPath, makeV2Index(near, far));

      const loaded = loadIndex(dbPath);
      assert.ok(loaded);
      assert.equal(loaded.schemaVersion, EXPERIENCE_INDEX_SCHEMA_VERSION);
      assert.equal(loaded.count, 2);
      assert.equal(loaded.items.length, 2);

      const nearLoaded = loaded.items.find((i) => i.id === "near");
      assert.ok(nearLoaded);
      assert.deepEqual(nearLoaded.vector, [1, 0, 0]);
      assert.deepEqual(nearLoaded.situationVector, [0, 1, 0]);
      assert.deepEqual(nearLoaded.evidenceVector, [0, 0, 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rankBySituation uses situationVector", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      // combined vectors reversed vs situation to ensure ranking is by situationVector
      const near: IndexedExperience = {
        id: "near",
        vector: [0, 1, 0],           // combined — reversed
        situationVector: [1, 0, 0],   // situation — matches query
        evidenceVector: [0, 0, 1],
        artifact: artifact("near", "near"),
      };
      const far: IndexedExperience = {
        id: "far",
        vector: [1, 0, 0],            // combined — would win with rankIndex
        situationVector: [0, 1, 0],   // situation — farther from query
        evidenceVector: [0, 0, 1],
        artifact: artifact("far", "far"),
      };

      writeFixtureIndexV2(dbPath, makeV2Index(near, far));

      const loaded = loadIndex(dbPath)!;
      const hits = rankBySituation(loaded, [1, 0, 0], 2).eligible;
      assert.equal(hits[0]?.artifact.id, "near", "situation cosine should rank 'near' first");

      const combined = rankIndex(loaded, [1, 0, 0], 2).eligible;
      assert.equal(combined[0]?.artifact.id, "far", "combined vector ranks 'far' first");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rankIndex and rankBySituation exclude non-injectable artifacts before the pool cap", () => {
    const index: ExperienceIndex = {
      indexedAt: "2026-08-27T00:00:00Z",
      schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
      embedding: { provider: "test", model: "fake", dimensions: 3 },
      count: 5,
      items: [
        {
          id: "private-top",
          vector: [1, 0, 0],
          situationVector: [1, 0, 0],
          evidenceVector: [1, 0, 0],
          artifact: artifact("private-top", "secret", { shareability: "private" }),
        },
        {
          id: "low-top",
          vector: [0.99, 0.01, 0],
          situationVector: [0.99, 0.01, 0],
          evidenceVector: [0.99, 0.01, 0],
          artifact: artifact("low-top", "low conf", { confidence: "low" }),
        },
        {
          id: "private-extra",
          vector: [0.98, 0.02, 0],
          situationVector: [0.98, 0.02, 0],
          evidenceVector: [0.98, 0.02, 0],
          artifact: artifact("private-extra", "secret extra", {
            shareability: "private",
          }),
        },
        {
          id: "empty-extra",
          vector: [0.97, 0.03, 0],
          situationVector: [0.97, 0.03, 0],
          evidenceVector: [0.97, 0.03, 0],
          artifact: artifact("empty-extra", "empty", { claimableLine: " " }),
        },
        {
          id: "public-third",
          vector: [0.9, 0.1, 0],
          situationVector: [0.9, 0.1, 0],
          evidenceVector: [0.9, 0.1, 0],
          artifact: artifact("public-third", "public claim"),
        },
      ],
    };

    const combinedWindow = rankIndex(index, [1, 0, 0], 1);
    const combined = combinedWindow.eligible;
    assert.equal(combined.length, 1);
    assert.equal(combined[0]?.artifact.id, "public-third");
    assert.deepEqual(
      combinedWindow.entries.map((entry) => entry.dropReason),
      ["shareability", "confidence", "shareability", "empty_claim", undefined]
    );

    const situationWindow = rankBySituation(index, [1, 0, 0], 1);
    const situation = situationWindow.eligible;
    assert.equal(situation.length, 1);
    assert.equal(situation[0]?.artifact.id, "public-third");
    assert.equal(situationWindow.entries.length, 5);
  });

  it("evidenceScore returns cosine between item evidenceVector and query", () => {
    const item: IndexedExperience = {
      id: "x",
      vector: [1, 0, 0],
      situationVector: [1, 0, 0],
      evidenceVector: [0, 0, 1],
      artifact: artifact("x", "x"),
    };
    const eqVector = [0, 0, 1];
    assert.ok(Math.abs(evidenceScore(item, eqVector) - 1.0) < 1e-6);
  });

  it("returns null for a pre-v3 index file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-v1-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const items: IndexedExperience[] = [
        {
          id: "v1item",
          vector: [1, 0, 0],
          situationVector: [1, 0, 0],
          evidenceVector: [1, 0, 0],
          artifact: artifact("v1item", "v1 artifact"),
        },
      ];
      writeFixtureIndexV1(dbPath, items);

      assert.equal(loadIndex(dbPath), null);
      assert.deepEqual(inspectIndex(dbPath), {
        status: "incompatible",
        schemaVersion: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the sqlite index file is missing", () => {
    const dbPath = join(tmpdir(), "does-not-exist-experience-index.db");
    assert.equal(loadIndex(dbPath), null);
    assert.deepEqual(inspectIndex(dbPath), { status: "missing" });
  });

  it("rankByLexical returns BM25 hits from FTS5 table", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-fts-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const postgres = artifact("postgres", "Postgres suggestion jobs", {
        domains: ["postgres", "jobs"],
        stack: ["Postgres"],
        problem: "Need durable suggestion jobs",
        approach: "Queued rows with claim semantics",
      });
      const kafka = artifact("kafka", "Kafka streams pipeline", {
        domains: ["kafka"],
        stack: ["Kafka"],
        problem: "Stream processing",
        approach: "Kafka Streams",
      });

      const index: ExperienceIndex = {
        indexedAt: "2026-08-27T00:00:00Z",
        schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
        embedding: { provider: "test", model: "fake", dimensions: 3 },
        count: 2,
        items: [
          {
            id: "postgres",
            vector: [1, 0, 0],
            situationVector: [1, 0, 0],
            evidenceVector: [1, 0, 0],
            artifact: postgres,
          },
          {
            id: "kafka",
            vector: [0, 1, 0],
            situationVector: [0, 1, 0],
            evidenceVector: [0, 1, 0],
            artifact: kafka,
          },
        ],
      };

      writeFixtureIndexV3(dbPath, index);

      const hits = rankByLexical(
        dbPath,
        buildFts5Query("postgres durable jobs"),
        5
      ).eligible;
      assert.ok(hits.length >= 1);
      assert.equal(hits[0]?.artifact.id, "postgres");
      assert.ok(hits[0]!.bm25Score < 0, "bm25 scores are negative; lower = better");

      const punctuationSafe = rankByLexical(
        dbPath,
        buildFts5Query("How do durable Postgres jobs work?"),
        5
      ).eligible;
      assert.equal(punctuationSafe[0]?.artifact.id, "postgres");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rankByLexical finds eligible hits behind more than three stronger exclusions", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-experience-index-fts-elig-"));
    const dbPath = join(dir, "experience-index.db");

    try {
      const privateHits = Array.from({ length: 4 }, (_, index) =>
        artifact(`private-jobs-${index}`, `Postgres durable private jobs ${index}`, {
          domains: ["postgres", "durable", "jobs"],
          stack: ["Postgres"],
          problem: "Postgres durable jobs retries",
          approach: "Durable Postgres jobs",
          shareability: "private",
        })
      );
      const publicHit = artifact("public-jobs", "Postgres public jobs", {
        domains: [],
        stack: [],
        problem: "",
        approach: "",
      });

      const index: ExperienceIndex = {
        indexedAt: "2026-08-27T00:00:00Z",
        schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
        embedding: { provider: "test", model: "fake", dimensions: 3 },
        count: 5,
        items: [
          ...privateHits.map((privateHit) => ({
            id: privateHit.id,
            vector: [1, 0, 0],
            situationVector: [1, 0, 0],
            evidenceVector: [1, 0, 0],
            artifact: privateHit,
          })),
          {
            id: "public-jobs",
            vector: [1, 0, 0],
            situationVector: [1, 0, 0],
            evidenceVector: [1, 0, 0],
            artifact: publicHit,
          },
        ],
      };

      writeFixtureIndexV3(dbPath, index);

      const window = rankByLexical(dbPath, buildFts5Query("postgres durable jobs"), 1);
      assert.equal(window.eligible.length, 1);
      assert.equal(window.eligible[0]?.artifact.id, "public-jobs");
      assert.equal(window.entries.length, 5);
      assert.ok(window.entries.slice(0, 4).every((entry) => entry.dropReason === "shareability"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rankByLexical distinguishes database failures from zero hits", () => {
    const dbPath = join(tmpdir(), `missing-fts-${process.pid}.db`);
    assert.throws(
      () => rankByLexical(dbPath, buildFts5Query("postgres"), 5),
      (error) =>
        error instanceof LexicalSearchError && error.reason === "db_open_failed"
    );
  });
});
