/** Domain contracts for Phase 1 triage — see docs/extension-integration.md */

export type TriageStatus =
  | "idle"
  | "queued"
  | "roasting"
  | "worth_it"
  | "not_worth_it"
  | "failed";

export interface FeedPostAuthor {
  name?: string;
  headline?: string;
}

export interface FeedPostMetrics {
  likes?: number;
  commentsCount?: number;
}

export interface FeedPostComment {
  author?: string;
  text: string;
  likes?: number;
}

export interface FeedPost {
  id: string;
  url?: string;
  text: string;
  author?: FeedPostAuthor;
  metrics: FeedPostMetrics;
  comments?: FeedPostComment[];
  /** Raw LinkedIn age label, e.g. "15m", "2h", "1d" */
  ageText?: string;
  extractedAt: string;
}

export interface TriageResult {
  feedPostId: string;
  status: TriageStatus;
  score: number;
  reasons: string[];
  error?: string;
  scoredAt?: string;
}

/** Side-panel row: feed snapshot + triage outcome */
export interface TriageEntry {
  post: FeedPost;
  triage: TriageResult;
}
