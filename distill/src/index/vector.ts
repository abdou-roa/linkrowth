import type { ExperienceArtifact } from "../types";

/**
 * Combined retrieval text — all semantic fields in one block.
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
 * Situation text — describes the context/problem of the experience.
 * Answers: "Is this the same kind of situation?"
 * Used for high-recall candidate generation in the split strategy.
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
 * Evidence text — describes the outcome/result of the experience.
 * Answers: "Is this experience usable evidence for the intended response?"
 * Used for post-analysis evidence scoring in the split strategy.
 * paths intentionally excluded — reserved for the Phase 3 BM25 lexical channel.
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
