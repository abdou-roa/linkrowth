import Database from "better-sqlite3";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  IndexedExperience,
  RankedArtifact,
} from "./types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "./types";
import { cosineSimilarity } from "./vector";

function decodeVector(blob: Buffer): number[] {
  const aligned = Buffer.from(blob);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/** Load a schema-v2 experience index from SQLite, or null if missing/incompatible. */
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
