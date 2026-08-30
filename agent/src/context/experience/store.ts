import Database from "better-sqlite3";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  IndexedExperience,
  RankedArtifact,
} from "./types";
import { cosineSimilarity } from "./vector";

/**
 * Minimal schema guard used to ensure index_meta / experiences tables exist
 * before we query them on v1 databases. v2 databases already have the full
 * schema written by distill's saveIndex, so this only runs for v1 compat.
 */
const SCHEMA_GUARD = `
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
`;

function decodeVector(blob: Buffer): number[] {
  const aligned = Buffer.from(blob);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/** Load the experience index from a local SQLite file, or null if missing/empty. */
export function loadIndex(dbPath: string): ExperienceIndex | null {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }

  try {
    db.exec(SCHEMA_GUARD);

    // Read meta — handle v1 databases that have no schema_version column.
    let meta:
      | {
          indexed_at: string;
          provider: string;
          model: string;
          dimensions: number;
          count: number;
          schema_version?: number;
        }
      | undefined;

    try {
      meta = db
        .prepare(
          `SELECT indexed_at, provider, model, dimensions, count, schema_version
           FROM index_meta WHERE id = 1`
        )
        .get() as typeof meta;
    } catch {
      // v1 database: schema_version column absent — retry without it.
      meta = db
        .prepare(
          `SELECT indexed_at, provider, model, dimensions, count
           FROM index_meta WHERE id = 1`
        )
        .get() as typeof meta;
    }

    if (!meta) return null;

    const schemaVersion = meta.schema_version ?? 1;

    let items: IndexedExperience[];

    if (schemaVersion >= 2) {
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

      items = rows.map((row) => ({
        id: row.id,
        vector: decodeVector(row.vector),
        situationVector: decodeVector(row.situation_vector),
        evidenceVector: decodeVector(row.evidence_vector),
        artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
      }));
    } else {
      // v1: single vector — use it as a stand-in for situation/evidence so the
      // single strategy works unchanged; split strategy will warn on version mismatch.
      const rows = db
        .prepare(`SELECT id, vector, artifact_json FROM experiences ORDER BY id`)
        .all() as Array<{ id: string; vector: Buffer; artifact_json: string }>;

      items = rows.map((row) => {
        const v = decodeVector(row.vector);
        return {
          id: row.id,
          vector: v,
          situationVector: v,
          evidenceVector: v,
          artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
        };
      });
    }

    return {
      indexedAt: meta.indexed_at,
      schemaVersion,
      embedding: {
        provider: meta.provider,
        model: meta.model,
        dimensions: meta.dimensions,
      },
      count: meta.count,
      items,
    };
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
