import type { ExperienceArtifact, IndexedExperience, RankedArtifact } from "./types";
import type { FusedCandidate } from "./types";

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

export type EligibilityDropReason = "shareability" | "confidence" | "empty_claim";

export interface CandidateWindowEntry<T extends { artifact: ExperienceArtifact }> {
  candidate: T;
  /** Position in the uncapped channel ranking (0-based). */
  rank: number;
  dropReason?: EligibilityDropReason;
}

export interface CandidateWindow<T extends { artifact: ExperienceArtifact }> {
  /** Injectable candidates; the pool cap counts only this list. */
  eligible: T[];
  /** Every candidate examined while filling the eligible pool. */
  entries: Array<CandidateWindowEntry<T>>;
}

export function eligibilityDropReason(
  artifact: ExperienceArtifact
): EligibilityDropReason | undefined {
  if (!ALLOWED_SHAREABILITY.has(artifact.shareability)) return "shareability";
  if (!ALLOWED_CONFIDENCE.has(artifact.confidence)) return "confidence";
  if (!artifact.claimableLine?.trim()) return "empty_claim";
  return undefined;
}

/**
 * Fill a candidate pool without letting ineligible rows consume its cap while
 * retaining every examined exclusion for trace observability.
 */
export function buildCandidateWindow<T extends { artifact: ExperienceArtifact }>(
  rankedCandidates: T[],
  poolSize: number
): CandidateWindow<T> {
  if (poolSize <= 0) return { eligible: [], entries: [] };

  const eligible: T[] = [];
  const entries: Array<CandidateWindowEntry<T>> = [];
  for (const [rank, candidate] of rankedCandidates.entries()) {
    const dropReason = eligibilityDropReason(candidate.artifact);
    entries.push({ candidate, rank, dropReason });
    if (!dropReason) eligible.push(candidate);
    if (eligible.length >= poolSize) break;
  }
  return { eligible, entries };
}

function evaluateRankedHits(
  hits: RankedArtifact[],
  k: number,
  passesRelevance: (hit: RankedArtifact, rank: number) => boolean
): HitDecision[] {
  let kept = 0;
  return hits.map((hit, rank) => {
    let dropReason: HitDropReason | undefined;
    if (!ALLOWED_SHAREABILITY.has(hit.artifact.shareability)) {
      dropReason = "shareability";
    } else if (!ALLOWED_CONFIDENCE.has(hit.artifact.confidence)) {
      dropReason = "confidence";
    } else if (!passesRelevance(hit, rank)) {
      dropReason = "min_score";
    } else if (!hit.artifact.claimableLine?.trim()) {
      dropReason = "empty_claim";
    } else if (kept >= k) {
      dropReason = "over_k";
    }

    const selected = dropReason === undefined;
    if (selected) kept += 1;
    return { hit, rank, selected, dropReason };
  });
}

/**
 * Hard eligibility for injection as a proof point (Phase 1 prefilter).
 * Score floors and top-k caps are applied later by evaluateHits.
 */
export function isInjectableArtifact(artifact: ExperienceArtifact): boolean {
  return eligibilityDropReason(artifact) === undefined;
}

/** Keep only indexed rows that could become proof points. */
export function filterInjectableItems(items: IndexedExperience[]): IndexedExperience[] {
  return items.filter((item) => isInjectableArtifact(item.artifact));
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
 *
 * Phase 1 prefilters the same eligibility rules before candidate pool caps;
 * these checks remain as defense in depth.
 */
export function evaluateHits(
  hits: RankedArtifact[],
  options: { minScore: number; k: number }
): HitDecision[] {
  return evaluateRankedHits(hits, options.k, (hit) => hit.score >= options.minScore);
}

/**
 * Evaluate RRF candidates without comparing RRF scores to a cosine threshold.
 * A candidate is relevant enough when the semantic channel clears its cosine
 * floor or the lexical channel recovered it.
 */
export function evaluateHybridHits(
  candidates: FusedCandidate[],
  options: { minSemanticScore: number; k: number }
): HitDecision[] {
  const ranked = candidates.map((candidate) => ({
    score: candidate.rrfScore,
    artifact: candidate.artifact,
  }));
  return evaluateRankedHits(ranked, options.k, (_hit, rank) => {
    const candidate = candidates[rank]!;
    return (
      candidate.lexicalRank !== undefined ||
      (candidate.situationScore !== undefined &&
        candidate.situationScore >= options.minSemanticScore)
    );
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
