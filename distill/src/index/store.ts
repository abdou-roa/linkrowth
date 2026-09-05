import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import type { EmbeddingMeta, ExperienceArtifact, ExperienceIndex, IndexedExperience } from "../types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "../types";
import { ensureParentDir } from "../paths";
import { roundVector } from "../util/text";
import { cosineSimilarity, evidenceText, lexicalFields, retrievalText, situationText } from "./vector";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface Bm25Weights {
  title: number;
  domains: number;
  stack: number;
  problem: number;
  approach: number;
  paths: number;
}

export const DEFAULT_BM25_WEIGHTS: Bm25Weights = {
  title: 3.0,
  domains: 2.0,
  stack: 2.0,
  problem: 2.0,
  approach: 1.5,
  paths: 0.5,
};

export interface LexicalRankedArtifact {
  bm25Score: number;
  artifact: ExperienceArtifact;
}

export type LexicalSearchFailureReason =
  | "db_open_failed"
  | "missing_fts_table"
  | "fts_syntax_error"
  | "fts_error";

export class LexicalSearchError extends Error {
  constructor(
    readonly reason: LexicalSearchFailureReason,
    message: string
  ) {
    super(message);
    this.name = "LexicalSearchError";
  }
}

const EMBED_BATCH = 32;

/** Authoritative v3 schema written to a fresh database on every full rebuild. */
const SCHEMA = `
CREATE TABLE index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  indexed_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  count INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT ${EXPERIENCE_INDEX_SCHEMA_VERSION}
);

CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  vector BLOB NOT NULL,
  situation_vector BLOB NOT NULL,
  evidence_vector BLOB NOT NULL,
  artifact_json TEXT NOT NULL
);

CREATE VIRTUAL TABLE experiences_fts USING fts5(
  id UNINDEXED,
  title,
  domains,
  stack,
  problem,
  approach,
  paths,
  tokenize = 'unicode61'
);
`;

export interface RankedArtifact {
  score: number;
  artifact: ExperienceArtifact;
}

export type ExperienceIndexInspection =
  | { status: "missing" }
  | { status: "incompatible"; schemaVersion: number | null }
  | { status: "corrupt" }
  | { status: "current"; count: number };

/**
 * Build the in-memory index by embedding three text representations per
 * artifact in a single interleaved batch:
 *   [combined₀, situation₀, evidence₀, combined₁, situation₁, evidence₁, …]
 * This halves round-trips compared to three sequential embed calls.
 */
export async function buildIndex(
  artifacts: ExperienceArtifact[],
  embed: EmbedFn,
  meta: EmbeddingMeta
): Promise<ExperienceIndex> {
  const items: IndexedExperience[] = [];

  for (let i = 0; i < artifacts.length; i += EMBED_BATCH) {
    const batch = artifacts.slice(i, i + EMBED_BATCH);

    // Interleave: [combined0, situation0, evidence0, combined1, …]
    const texts: string[] = [];
    for (const artifact of batch) {
      texts.push(retrievalText(artifact));
      texts.push(situationText(artifact));
      texts.push(evidenceText(artifact));
    }

    const vectors = await embed(texts);
    if (vectors.length !== texts.length) {
      throw new Error(`embed: expected ${texts.length} vectors, got ${vectors.length}`);
    }

    for (let j = 0; j < batch.length; j++) {
      const artifact = batch[j]!;
      const base = j * 3;
      const vector = vectors[base];
      const sVector = vectors[base + 1];
      const eVector = vectors[base + 2];
      if (!vector?.length || !sVector?.length || !eVector?.length) {
        throw new Error(`embed: empty vector for ${artifact.id}`);
      }
      items.push({
        id: artifact.id,
        vector: roundVector(vector),
        situationVector: roundVector(sVector),
        evidenceVector: roundVector(eVector),
        artifact,
      });
    }
  }

  const dimensions = items[0]?.vector.length ?? 0;

  return {
    indexedAt: new Date().toISOString(),
    schemaVersion: EXPERIENCE_INDEX_SCHEMA_VERSION,
    embedding: { ...meta, dimensions: dimensions || meta.dimensions },
    count: items.length,
    items,
  };
}

export function rankIndex(
  index: ExperienceIndex,
  queryVector: number[],
  k = 5
): RankedArtifact[] {
  if (k <= 0 || index.items.length === 0) return [];

  return index.items
    .map((item) => ({
      score: cosineSimilarity(queryVector, item.vector),
      artifact: item.artifact,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Rank by situation cosine only — high-recall candidate generation for the split strategy. */
export function rankBySituation(
  index: ExperienceIndex,
  queryVector: number[],
  k = 5
): RankedArtifact[] {
  if (k <= 0 || index.items.length === 0) return [];

  return index.items
    .map((item) => ({
      score: cosineSimilarity(queryVector, item.situationVector),
      artifact: item.artifact,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Rank by evidence cosine for offline inspection and evaluation. */
export function rankByEvidence(
  index: ExperienceIndex,
  queryVector: number[],
  k = 5
): RankedArtifact[] {
  if (k <= 0 || index.items.length === 0) return [];

  return index.items
    .map((item) => ({
      score: cosineSimilarity(queryVector, item.evidenceVector),
      artifact: item.artifact,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function encodeVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function decodeVector(blob: Buffer): number[] {
  const aligned = Buffer.from(blob);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/** Inspect index schema state without mutating the database. */
export function inspectIndex(dbPath: string): ExperienceIndexInspection {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return { status: "missing" };
  }

  try {
    const metaColumns = db.prepare("PRAGMA table_info(index_meta)").all() as Array<{
      name: string;
    }>;
    if (metaColumns.length === 0) return { status: "corrupt" };
    if (!metaColumns.some((column) => column.name === "schema_version")) {
      return { status: "incompatible", schemaVersion: null };
    }

    const meta = db
      .prepare("SELECT schema_version, count FROM index_meta WHERE id = 1")
      .get() as { schema_version: number; count: number } | undefined;
    if (!meta) return { status: "corrupt" };
    if (meta.schema_version !== EXPERIENCE_INDEX_SCHEMA_VERSION) {
      return { status: "incompatible", schemaVersion: meta.schema_version };
    }

    const experienceColumns = new Set(
      (
        db.prepare("PRAGMA table_info(experiences)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name)
    );
    for (const required of ["vector", "situation_vector", "evidence_vector", "artifact_json"]) {
      if (!experienceColumns.has(required)) return { status: "corrupt" };
    }
    const ftsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'experiences_fts'")
      .get();
    if (!ftsTable) return { status: "corrupt" };
    return { status: "current", count: meta.count };
  } catch {
    return { status: "corrupt" };
  } finally {
    db.close();
  }
}

/**
 * Replace the local SQLite index atomically.
 *
 * The complete rebuild is committed to a sibling temporary database before it
 * replaces the live file, so an insert or schema failure preserves the last
 * valid index.
 */
export function saveIndex(dbPath: string, index: ExperienceIndex): void {
  ensureParentDir(dbPath);
  const tempPath = `${dbPath}.${process.pid}.${randomUUID()}.tmp`;
  let db: Database.Database | undefined;

  try {
    db = new Database(tempPath);
    const rebuild = db.transaction(() => {
      db!.exec(SCHEMA);

      db!.prepare(
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

      const insert = db!.prepare(
        `INSERT INTO experiences (id, vector, situation_vector, evidence_vector, artifact_json)
         VALUES (@id, @vector, @situationVector, @evidenceVector, @artifactJson)`
      );
      const insertFts = db!.prepare(
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
    });
    rebuild();
    db.close();
    db = undefined;
    renameSync(tempPath, dbPath);
  } catch (error) {
    db?.close();
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/** Load a schema-v3 experience index from SQLite, or null if missing/incompatible. */
export function loadIndex(dbPath: string): ExperienceIndex | null {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }

  try {
    const meta = db
      .prepare(
        `SELECT indexed_at, provider, model, dimensions, count, schema_version
         FROM index_meta WHERE id = 1`
      )
      .get() as
      | {
          indexed_at: string;
          provider: string;
          model: string;
          dimensions: number;
          count: number;
          schema_version: number;
        }
      | undefined;

    if (!meta || meta.schema_version !== EXPERIENCE_INDEX_SCHEMA_VERSION) {
      return null;
    }

    const rows = db
      .prepare(
        `SELECT id, vector, situation_vector, evidence_vector, artifact_json
         FROM experiences ORDER BY id`
      )
      .all() as Array<{
        id: string;
        vector: Buffer;
        situation_vector: Buffer;
        evidence_vector: Buffer;
        artifact_json: string;
      }>;

    const items: IndexedExperience[] = rows.map((row) => ({
      id: row.id,
      vector: decodeVector(row.vector),
      situationVector: decodeVector(row.situation_vector),
      evidenceVector: decodeVector(row.evidence_vector),
      artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
    }));

    return {
      indexedAt: meta.indexed_at,
      schemaVersion: meta.schema_version,
      embedding: {
        provider: meta.provider,
        model: meta.model,
        dimensions: meta.dimensions,
      },
      count: meta.count,
      items,
    };
  } catch {
    // Wrong schema, missing columns, or corrupt file.
    return null;
  } finally {
    db.close();
  }
}

/**
 * BM25 lexical search over the FTS5 index.
 * bm25() returns negative values; lower (more negative) = better match.
 */
export function rankByLexical(
  dbPath: string,
  fts5Query: string,
  k = 5,
  weights: Bm25Weights = DEFAULT_BM25_WEIGHTS
): LexicalRankedArtifact[] {
  const query = fts5Query.trim();
  if (!query || k <= 0) return [];

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new LexicalSearchError(
      "db_open_failed",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const rows = db
      .prepare(
        `SELECT f.id,
                bm25(experiences_fts, 0, @wTitle, @wDomains, @wStack, @wProblem, @wApproach, @wPaths) AS score,
                e.artifact_json
         FROM experiences_fts f
         JOIN experiences e ON e.id = f.id
         WHERE experiences_fts MATCH @query
         ORDER BY score
         LIMIT @k`
      )
      .all({
        query,
        k,
        wTitle: weights.title,
        wDomains: weights.domains,
        wStack: weights.stack,
        wProblem: weights.problem,
        wApproach: weights.approach,
        wPaths: weights.paths,
      }) as Array<{ id: string; score: number; artifact_json: string }>;

    return rows.map((row) => ({
      bm25Score: row.score,
      artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason: LexicalSearchFailureReason = message.includes("no such table")
      ? "missing_fts_table"
      : message.includes("syntax error")
        ? "fts_syntax_error"
        : "fts_error";
    throw new LexicalSearchError(reason, message);
  } finally {
    db.close();
  }
}
