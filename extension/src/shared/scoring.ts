import type { FeedPost, TriageResult } from "./types";

export interface ScoreThresholds {
  /** Minimum score to mark Worth it */
  worthItMin: number;
}

export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  worthItMin: 50,
};

/** Comment weight vs a like when building an interaction total. */
const COMMENT_WEIGHT = 3;

/**
 * Engagement-velocity scorer.
 * Inputs: text richness + post age + likes/comments (interactions over time).
 *
 * Missing likes must not collapse scoring — LinkedIn often hides reaction
 * counts while comment counts still extract.
 */
export function scoreFeedPost(
  post: FeedPost,
  thresholds: ScoreThresholds = DEFAULT_THRESHOLDS,
): TriageResult {
  const reasons: string[] = [];
  let score = 0;

  const likes = post.metrics.likes;
  const comments = post.metrics.commentsCount;
  const likesKnown = likes !== undefined;
  const commentsKnown = comments !== undefined;
  const interactions = (likes ?? 0) + (comments ?? 0) * COMMENT_WEIGHT;
  const hoursOld = parseHoursOld(post.ageText);

  // Dead rule only when we know engagement is cold (not just missing likes).
  if (
    hoursOld !== undefined &&
    hoursOld > 12 &&
    likesKnown &&
    (likes as number) < 5 &&
    (comments ?? 0) < 2
  ) {
    return {
      feedPostId: post.id,
      status: "not_worth_it",
      score: 0,
      reasons: ["old with no traction"],
      scoredAt: new Date().toISOString(),
    };
  }

  score += scoreText(post.text, reasons);

  const inGracePeriod =
    hoursOld !== undefined && hoursOld < 1 && interactions < 5;

  if (inGracePeriod) {
    reasons.push("too new to judge metrics");
  } else if (hoursOld === undefined) {
    score += scoreAbsoluteEngagement(interactions, comments ?? 0, reasons);
    reasons.push("age unknown");
  } else {
    score += scoreVelocity(
      hoursOld,
      interactions,
      comments ?? 0,
      likesKnown,
      commentsKnown,
      reasons,
    );
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

/**
 * Parse LinkedIn-style relative age ("15m", "2h", "1d", "Just now") into hours.
 * Returns undefined when the label cannot be parsed.
 */
export function parseHoursOld(ageText: string | undefined): number | undefined {
  if (!ageText) return undefined;
  const t = ageText.toLowerCase().replace(/\s+/g, " ").trim();

  if (/^(just\s*now|now|a\s*few\s*seconds?|moments?\s*ago)$/i.test(t)) {
    return 1 / 60;
  }

  const match = t.match(
    /(\d+(?:\.\d+)?)\s*(months?|mo|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|m)\b/i,
  );
  if (!match) return undefined;

  const n = Number(match[1]);
  if (Number.isNaN(n) || n < 0) return undefined;

  const unit = match[2].toLowerCase();
  if (unit.startsWith("mo") || unit === "month" || unit === "months") {
    return n * 30 * 24;
  }
  if (unit.startsWith("w")) return n * 7 * 24;
  if (unit.startsWith("d") && !unit.startsWith("mi")) return n * 24;
  if (unit.startsWith("h")) return Math.max(n, 1 / 60);
  // minutes (m / min / mins / minute / minutes)
  return Math.max(n / 60, 1 / 60);
}

function scoreText(text: string, reasons: string[]): number {
  const textLen = text.trim().length;
  if (textLen >= 280) {
    reasons.push("substantive text");
    return 25;
  }
  if (textLen >= 80) {
    reasons.push("moderate text");
    return 15;
  }
  if (textLen > 0) {
    reasons.push("thin text");
    return 5;
  }
  reasons.push("empty text");
  return 0;
}

function scoreVelocity(
  hoursOld: number,
  interactions: number,
  comments: number,
  likesKnown: boolean,
  commentsKnown: boolean,
  reasons: string[],
): number {
  let points = 0;
  const safeHours = Math.max(hoursOld, 1 / 60);
  const interactionRate = interactions / safeHours;
  const commentRate = comments / safeHours;

  // Absolute interactivity always counts — age mustn't erase comment signal.
  if (comments >= 15 || commentRate >= 5) {
    points += 50;
    reasons.push("highly interactive");
  } else if (comments >= 5) {
    points += 15;
    reasons.push("some comments");
  }

  // Viral velocity in the first ~half day
  if (hoursOld < 12 && interactionRate >= 15) {
    points += 40;
    reasons.push("high velocity");
  }

  // Early traction window
  if (hoursOld < 2 && interactions >= 10) {
    points += 30;
    reasons.push("strong early traction");
  }

  // Steady performer — only trust rate when likes were extracted.
  // Otherwise comment absolute bonuses above already covered engagement.
  if (hoursOld >= 1 && likesKnown) {
    const steady = Math.min(30, Math.round(interactionRate));
    if (steady > 0) {
      points += steady;
      reasons.push("steady engagement");
    }
  } else if (hoursOld >= 1 && !likesKnown && commentsKnown && comments > 0) {
    // Soft credit when only comments are known
    const soft = Math.min(15, Math.round((comments * COMMENT_WEIGHT) / safeHours));
    if (soft > 0) {
      points += soft;
      reasons.push("comment velocity");
    }
  }

  if (!likesKnown) {
    reasons.push("likes unknown");
  }

  return points;
}

/** Fallback when age could not be extracted from the card. */
function scoreAbsoluteEngagement(
  interactions: number,
  comments: number,
  reasons: string[],
): number {
  let points = 0;

  if (comments >= 15) {
    points += 50;
    reasons.push("highly interactive");
  } else if (comments >= 5) {
    points += 15;
    reasons.push("some comments");
  }

  if (interactions >= 80) {
    points += 30;
    reasons.push("high engagement");
  } else if (interactions >= 20) {
    points += 15;
    reasons.push("some engagement");
  }

  return points;
}
