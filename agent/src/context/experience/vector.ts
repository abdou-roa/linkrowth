import type { ExperienceArtifact } from "./types";

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

/** Deterministic retrieval text — mirrors distill indexing so queries stay aligned. */
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
