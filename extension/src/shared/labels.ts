import type { TriageResult, TriageStatus } from "./types";

/** User-facing status labels — never expose internal codenames. */
export const STATUS_LABEL: Record<TriageStatus, string> = {
  idle: "",
  queued: "Queued",
  roasting: "Analyzing…",
  worth_it: "Good to engage",
  not_worth_it: "Skip",
  failed: "Couldn’t analyze",
};

export type ScoreTier = "high" | "medium" | "low";

/**
 * Engagement potential tiers. `worth_it` starts at 50; high is a stronger signal.
 */
export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export const TIER_LABEL: Record<ScoreTier, string> = {
  high: "High potential",
  medium: "Medium potential",
  low: "Low potential",
};

/** Cap display at 100 so the bar reads as a percentage-like scale. */
export function displayScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Machine reasons from the scorer → one short sentence for humans.
 * Drops telemetry-style fragments (likes unknown, age unknown).
 */
export function summarizeReasons(
  reasons: string[],
  opts?: { status?: TriageStatus; error?: string },
): string {
  if (opts?.error) return opts.error;

  const skip = new Set([
    "likes unknown",
    "age unknown",
    "empty text",
  ]);

  const cleaned = reasons
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !skip.has(r.toLowerCase()));

  if (cleaned.length === 0) {
    if (opts?.status === "worth_it") return "Looks like a solid engagement window.";
    if (opts?.status === "not_worth_it") return "Weak signal for engagement right now.";
    return "";
  }

  const mapped = cleaned.map(humanizeReason);
  if (mapped.length === 1) return mapped[0];
  if (mapped.length === 2) return `${mapped[0]} · ${mapped[1]}`;
  return `${mapped[0]} · ${mapped[1]} · +${mapped.length - 2} more`;
}

function humanizeReason(raw: string): string {
  const key = raw.toLowerCase();
  const map: Record<string, string> = {
    "old with no traction": "Old post with little traction",
    "substantive text": "Substantive post",
    "moderate text": "Decent post length",
    "thin text": "Short post",
    "too new to judge metrics": "Too new to judge from metrics yet",
    "highly interactive": "Highly interactive thread",
    "some comments": "Has some comments",
    "high velocity": "Rising fast",
    "strong early traction": "Strong early traction",
    "steady engagement": "Steady engagement",
    "comment velocity": "Comments picking up",
    "high engagement": "High engagement",
    "some engagement": "Some engagement",
  };
  return map[key] ?? raw;
}

export function statusLabel(status: TriageStatus): string {
  return STATUS_LABEL[status] || status;
}

export function triageHeadline(triage: TriageResult): string {
  const base = statusLabel(triage.status);
  if (triage.status !== "worth_it" && triage.status !== "not_worth_it") {
    return base;
  }
  const tier = scoreTier(triage.score);
  if (triage.status === "worth_it") {
    return `${base} · ${TIER_LABEL[tier]}`;
  }
  return base;
}
