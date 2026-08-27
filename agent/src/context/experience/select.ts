import type { RankedArtifact } from "./types";

const ALLOWED_SHAREABILITY = new Set(["public", "anonymized"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium"]);

/**
 * Truth filters for retrieved hits before they become proofPoints.
 * - Drop private shareability (never injectable).
 * - Drop low confidence (prefer high/medium).
 * - Drop below the cosine score floor (irrelevant hits are actively harmful).
 */
export function selectClaimableHits(
  hits: RankedArtifact[],
  options: { minScore: number; k: number }
): RankedArtifact[] {
  return hits
    .filter((hit) => ALLOWED_SHAREABILITY.has(hit.artifact.shareability))
    .filter((hit) => ALLOWED_CONFIDENCE.has(hit.artifact.confidence))
    .filter((hit) => hit.score >= options.minScore)
    .filter((hit) => Boolean(hit.artifact.claimableLine?.trim()))
    .slice(0, options.k);
}

/** Merge retrieved claimable lines into existing proofPoints without duplicates. */
export function mergeProofPoints(
  existing: string[] | undefined,
  claimableLines: string[]
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const line of [...(existing ?? []), ...claimableLines]) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }

  return merged;
}
