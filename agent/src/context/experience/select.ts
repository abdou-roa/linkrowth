import type { RankedArtifact } from "./types";

const ALLOWED_SHAREABILITY = new Set(["public", "anonymized"]);
const ALLOWED_CONFIDENCE = new Set(["high", "medium"]);

/** Why a ranked hit was dropped, or undefined when it was selected. */
export type HitDropReason =
  | "shareability"
  | "confidence"
  | "min_score"
  | "empty_claim"
  | "over_k";

export interface HitDecision {
  hit: RankedArtifact;
  /** Position in the input ranking (0-based). */
  rank: number;
  selected: boolean;
  dropReason?: HitDropReason;
}

/**
 * Single source of truth for retrieval selection. Annotates every hit with a
 * keep/drop decision so both selection and observability read from one place.
 * Filters, in order:
 * - Drop private shareability (never injectable).
 * - Drop low confidence (prefer high/medium).
 * - Drop below the cosine score floor (irrelevant hits are actively harmful).
 * - Drop empty claimable lines.
 * - Keep only the first k survivors (rest marked "over_k").
 */
export function evaluateHits(
  hits: RankedArtifact[],
  options: { minScore: number; k: number }
): HitDecision[] {
  let kept = 0;
  return hits.map((hit, rank) => {
    let dropReason: HitDropReason | undefined;
    if (!ALLOWED_SHAREABILITY.has(hit.artifact.shareability)) {
      dropReason = "shareability";
    } else if (!ALLOWED_CONFIDENCE.has(hit.artifact.confidence)) {
      dropReason = "confidence";
    } else if (hit.score < options.minScore) {
      dropReason = "min_score";
    } else if (!hit.artifact.claimableLine?.trim()) {
      dropReason = "empty_claim";
    } else if (kept >= options.k) {
      dropReason = "over_k";
    }

    const selected = dropReason === undefined;
    if (selected) kept += 1;
    return { hit, rank, selected, dropReason };
  });
}

/**
 * Truth filters for retrieved hits before they become proofPoints.
 * Thin wrapper over evaluateHits so selection semantics live in one place.
 */
export function selectClaimableHits(
  hits: RankedArtifact[],
  options: { minScore: number; k: number }
): RankedArtifact[] {
  return evaluateHits(hits, options)
    .filter((decision) => decision.selected)
    .map((decision) => decision.hit);
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
