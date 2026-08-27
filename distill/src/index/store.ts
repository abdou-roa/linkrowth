import Database from "better-sqlite3";
import type { EmbeddingMeta, ExperienceArtifact, ExperienceIndex, IndexedExperience } from "../types";
import { ensureParentDir } from "../paths";
import { roundVector } from "../util/text";
import { cosineSimilarity, retrievalText } from "./vector";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const EMBED_BATCH = 32;

const SCHEMA = `
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

export async function buildIndex(
  artifacts: ExperienceArtifact[],
  embed: EmbedFn,
  meta: EmbeddingMeta
): Promise<ExperienceIndex> {
  const items: IndexedExperience[] = [];

  for (let i = 0; i < artifacts.length; i += EMBED_BATCH) {
    const batch = artifacts.slice(i, i + EMBED_BATCH);
    const texts = batch.map(retrievalText);
    const vectors = await embed(texts);
    if (vectors.length !== batch.length) {
      throw new Error(`embed: expected ${batch.length} vectors, got ${vectors.length}`);
    }
    for (let j = 0; j < batch.length; j++) {
      const artifact = batch[j]!;
      const vector = vectors[j];
      if (!vector?.length) {
        throw new Error(`embed: empty vector for ${artifact.id}`);
      }
      items.push({
        id: artifact.id,
        vector: roundVector(vector),
        artifact,
      });
    }
  }

  const dimensions = items[0]?.vector.length ?? 0;

  return {
    indexedAt: new Date().toISOString(),
    embedding: { ...meta, dimensions: dimensions || meta.dimensions },
    count: items.length,
    items,
  };
}

export interface RankedArtifact {
  score: number;
  artifact: ExperienceArtifact;
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
    const replace = db.transaction(() => {
      db.prepare("DELETE FROM experiences").run();
      db.prepare("DELETE FROM index_meta").run();

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
    });
    replace();
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
    db.exec(SCHEMA);
    const meta = db
      .prepare(
        `SELECT indexed_at, provider, model, dimensions, count FROM index_meta WHERE id = 1`
      )
      .get() as
      | {
          indexed_at: string;
          provider: string;
          model: string;
          dimensions: number;
          count: number;
        }
      | undefined;

    if (!meta) return null;

    const rows = db
      .prepare(`SELECT id, vector, artifact_json FROM experiences ORDER BY id`)
      .all() as Array<{ id: string; vector: Buffer; artifact_json: string }>;

    const items: IndexedExperience[] = rows.map((row) => ({
      id: row.id,
      vector: decodeVector(row.vector),
      artifact: JSON.parse(row.artifact_json) as ExperienceArtifact,
    }));

    return {
      indexedAt: meta.indexed_at,
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
