import type { EmbeddingMeta, ExperienceArtifact, ExperienceIndex, IndexedExperience } from "../types";
import { roundVector } from "../util/text";
import { cosineSimilarity, retrievalText } from "./vector";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const EMBED_BATCH = 32;

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
