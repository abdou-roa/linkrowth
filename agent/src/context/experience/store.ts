import Database from "better-sqlite3";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  IndexedExperience,
  RankedArtifact,
} from "./types";
import { cosineSimilarity } from "./vector";

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
