import type { ExperienceArtifact } from "./types";

/**
 * Combined retrieval text — all semantic fields in one block.
 * Mirrored from distill/src/index/vector.ts; keep in sync.
 * Used by the single-vector strategy (LINKROWTH_RETRIEVAL_STRATEGY=single).
 */
export function retrievalText(artifact: ExperienceArtifact): string {
  return [
    artifact.title,
    artifact.domains.join(", "),
    artifact.stack.join(", "),
    artifact.problem,
    artifact.approach,
    artifact.tradeoff,
    artifact.claimableLine,
    artifact.paths.slice(0, 24).join("\n"),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Situation text — title + domains + stack + problem.
 * Answers: "Is this the same kind of situation?"
 * Mirrored from distill/src/index/vector.ts; keep in sync.
 */
export function situationText(artifact: ExperienceArtifact): string {
  return [
    artifact.title,
    artifact.domains.join(", "),
    artifact.stack.join(", "),
    artifact.problem,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Evidence text — approach + tradeoff + claimableLine.
 * Answers: "Is this experience usable evidence for the intended response?"
 * paths intentionally excluded — reserved for the Phase 3 BM25 lexical channel.
 * Mirrored from distill/src/index/vector.ts; keep in sync.
 */
export function evidenceText(artifact: ExperienceArtifact): string {
  return [
    artifact.approach,
    artifact.tradeoff,
    artifact.claimableLine,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Lexical document fields for FTS5 BM25 indexing.
 * Mirrored from distill/src/index/vector.ts; keep in sync.
 */
export function lexicalFields(artifact: ExperienceArtifact): {
  title: string;
  domains: string;
  stack: string;
  problem: string;
  approach: string;
  paths: string;
} {
  return {
    title: artifact.title.trim(),
    domains: artifact.domains.join(", "),
    stack: artifact.stack.join(", "),
    problem: artifact.problem.trim(),
    approach: artifact.approach.trim(),
    paths: artifact.paths.slice(0, 24).join(" "),
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
