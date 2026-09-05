import Database from "better-sqlite3";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  IndexedExperience,
  LexicalRankedArtifact,
  RankedArtifact,
} from "./types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "./types";
import { buildFts5Query, DEFAULT_BM25_WEIGHTS, type Bm25Weights } from "./fts";
import { cosineSimilarity } from "./vector";

export { buildFts5Query, fuseRRF, DEFAULT_BM25_WEIGHTS, type Bm25Weights } from "./fts";

export type ExperienceIndexInspection =
  | { status: "missing" }
  | { status: "incompatible"; schemaVersion: number | null }
  | { status: "corrupt" }
  | { status: "current"; count: number };

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

function decodeVector(blob: Buffer): number[] {
  const aligned = Buffer.from(blob);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/** Inspect an index that failed to load so callers can emit an actionable diagnostic. */
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

/** Rank by combined retrievalText cosine — the single-vector baseline strategy. */
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

/**
 * Evidence cosine for a single indexed artifact against a pre-embedded evidence
 * query vector. Returned as a trace annotation, not used to gate selection in
 * Phase 2.
 */
export function evidenceScore(item: IndexedExperience, evidenceQueryVector: number[]): number {
  return cosineSimilarity(item.evidenceVector, evidenceQueryVector);
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
