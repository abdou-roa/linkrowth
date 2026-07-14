import type { FeedPost, TriageResult } from "./types";

export interface ScoreThresholds {
  /** Minimum score to mark Worth it */
  worthItMin: number;
}

export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  worthItMin: 50,
};

/**
 * Phase 1 heuristic scorer (stub formula — tune later).
 * Inputs: text richness + engagement metrics.
 */
export function scoreFeedPost(
  post: FeedPost,
  thresholds: ScoreThresholds = DEFAULT_THRESHOLDS,
): TriageResult {
  const reasons: string[] = [];
  let score = 0;

  const textLen = post.text.trim().length;
  if (textLen >= 280) {
    score += 25;
    reasons.push("substantive text");
  } else if (textLen >= 80) {
    score += 15;
    reasons.push("moderate text");
  } else if (textLen > 0) {
    score += 5;
    reasons.push("thin text");
  } else {
    reasons.push("empty text");
  }

  const likes = post.metrics.likes ?? 0;
  if (likes >= 50) {
    score += 30;
    reasons.push("high likes");
  } else if (likes >= 10) {
    score += 15;
    reasons.push("some likes");
  }

  const comments = post.metrics.commentsCount ?? 0;
  if (comments >= 20) {
    score += 30;
    reasons.push("high comments");
  } else if (comments >= 5) {
    score += 15;
    reasons.push("some comments");
  }

  const status = score >= thresholds.worthItMin ? "worth_it" : "not_worth_it";

  return {
    feedPostId: post.id,
    status,
    score,
    reasons,
    scoredAt: new Date().toISOString(),
  };
}
