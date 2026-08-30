/** Request/response shapes for extension → API suggestion flow. */
import type {
  ClarificationSummary as DbClarificationSummary,
  SuggestionJobStatus as DbSuggestionJobStatus,
  SuggestionRunSummary as DbSuggestionRunSummary,
} from "@linkrowth/db";

export interface FeedPostAuthorInput {
  name?: string;
  headline?: string;
  profileUrl?: string;
  username?: string;
}

export interface FeedPostMetricsInput {
  likes?: number;
  commentsCount?: number;
}

export interface FeedPostCommentInput {
  author?: string;
  text: string;
  likes?: number;
}

export interface FeedPostInput {
  id: string;
  url?: string;
  text: string;
  author?: FeedPostAuthorInput;
  metrics?: FeedPostMetricsInput;
  comments?: FeedPostCommentInput[];
  ageText?: string;
  extractedAt: string;
}

export interface TriageInput {
  status?: string;
  score?: number;
  reasons?: string[];
  error?: string;
  scoredAt?: string;
}

export interface CreateSuggestionRequest {
  feedPost: FeedPostInput;
  triage?: TriageInput;
  /** Optional user notes / angle for the suggestion (empty = quick suggestion). */
  notes?: string;
}

export type SuggestionJobStatus = DbSuggestionJobStatus;

export type ClarificationSummary = DbClarificationSummary;

export interface CreateSuggestionResponse {
  jobId: string;
  postId: string;
  status: SuggestionJobStatus;
}

export type SuggestionRunSummary = DbSuggestionRunSummary;

export interface GetSuggestionResponse {
  jobId: string;
  postId: string;
  status: SuggestionJobStatus;
  error: string | null;
  run: SuggestionRunSummary | null;
  clarification: ClarificationSummary | null;
}
