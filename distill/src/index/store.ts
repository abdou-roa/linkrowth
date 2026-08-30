import Database from "better-sqlite3";
import type { EmbeddingMeta, ExperienceArtifact, ExperienceIndex, IndexedExperience } from "../types";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "../types";
import { ensureParentDir } from "../paths";
import { roundVector } from "../util/text";
import { cosineSimilarity, evidenceText, retrievalText, situationText } from "./vector";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const EMBED_BATCH = 32;

/**
 * v2 schema: drops and recreates tables on every full rebuild so the column
 * layout is always authoritative. saveIndex is an offline tool, so this is safe.
 */
const SCHEMA = `
DROP TABLE IF EXISTS experiences;
DROP TABLE IF EXISTS index_meta;

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
`;

export interface RankedArtifact {
  score: number;
  artifact: ExperienceArtifact;
}

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

function encodeVector(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function decodeVector(blob: Buffer): number[] {
  const aligned = Buffer.from(blob);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4));
}

/** Replace the local SQLite index with a full rebuild. */
export function saveIndex(dbPath: string, index: ExperienceIndex): void {
  ensureParentDir(dbPath);
  const db = new Database(dbPath);
  try {
    db.exec(SCHEMA);

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
    const insertAll = db.transaction(() => {
      for (const item of index.items) {
        insert.run({
          id: item.id,
          vector: encodeVector(item.vector),
          situationVector: encodeVector(item.situationVector),
          evidenceVector: encodeVector(item.evidenceVector),
          artifactJson: JSON.stringify(item.artifact),
        });
      }
    });
    insertAll();
  } finally {
    db.close();
  }
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
    // Read meta — use a broad SELECT and fall back gracefully for v1 databases
    // that have no schema_version column.
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

    let rows: Array<{
      id: string;
      vector: Buffer;
      situation_vector?: Buffer;
      evidence_vector?: Buffer;
      artifact_json: string;
    }>;

    if (schemaVersion >= 2) {
      rows = db
        .prepare(
          `SELECT id, vector, situation_vector, evidence_vector, artifact_json
           FROM experiences ORDER BY id`
        )
        .all() as typeof rows;
    } else {
      // v1: only combined vector; use it as a stand-in for situation/evidence.
      const v1Rows = db
        .prepare(`SELECT id, vector, artifact_json FROM experiences ORDER BY id`)
        .all() as Array<{ id: string; vector: Buffer; artifact_json: string }>;
      rows = v1Rows.map((r) => ({ ...r, situation_vector: r.vector, evidence_vector: r.vector }));
    }

    const items: IndexedExperience[] = rows.map((row) => ({
      id: row.id,
      vector: decodeVector(row.vector),
      situationVector: decodeVector(row.situation_vector ?? row.vector),
      evidenceVector: decodeVector(row.evidence_vector ?? row.vector),
      artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
    }));

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
