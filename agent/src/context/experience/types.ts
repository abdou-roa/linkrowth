/**
 * Experience-index types mirrored from distill (read-only consumer side).
 * Agent never imports distill/ — only reads experience-index.db.
 */

export type ExperienceSource = "github_pr" | "local_git" | "cursor_chat";

export type ArtifactConfidence = "high" | "medium" | "low";
export type ArtifactShareability = "public" | "anonymized" | "private";

/** Structured, claimable experience. claimableLine maps into UserContext.proofPoints. */
export interface ExperienceArtifact {
  id: string;
  sourceCandidateId: string;
  source: ExperienceSource;
  repo: string;
  implementationDate: string;
  title: string;
  domains: string[];
  stack: string[];
  problem: string;
  approach: string;
  tradeoff: string;
  claimableLine: string;
  confidence: ArtifactConfidence;
  shareability: ArtifactShareability;
  paths: string[];
}

export interface EmbeddingMeta {
  provider: string;
  model: string;
  dimensions: number;
}

/** Schema version written by distill's saveIndex. 1 = single vector; 2 = split vectors. */
export const EXPERIENCE_INDEX_SCHEMA_VERSION = 2;

export interface IndexedExperience {
  id: string;
  /** Combined retrievalText() vector — used by the single-vector strategy. */
  vector: number[];
  /** situationText() vector: title + domains + stack + problem. */
  situationVector: number[];
  /** evidenceText() vector: approach + tradeoff + claimableLine. */
  evidenceVector: number[];
  artifact: ExperienceArtifact;
}

/** In-memory view of distill/data/experience-index.db. */
export interface ExperienceIndex {
  indexedAt: string;
  schemaVersion: number;
  embedding: EmbeddingMeta;
  count: number;
  items: IndexedExperience[];
}

export interface RankedArtifact {
  score: number;
  artifact: ExperienceArtifact;
}
