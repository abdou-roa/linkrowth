export interface PostAuthorInput {
  name?: string;
  headline?: string;
  profileUrl?: string;
  username?: string;
}

export interface PostMetricsInput {
  likes?: number;
  commentsCount?: number;
}

export interface PostCommentInput {
  author?: string;
  text: string;
  likes?: number;
}

export interface PostInput {
  id: string;
  url?: string;
  text: string;
  author?: PostAuthorInput;
  metrics?: PostMetricsInput;
  comments?: PostCommentInput[];
  ageText?: string;
  extractedAt?: string;
}

export interface TriageInput {
  status?: string;
  score?: number;
  reasons?: string[];
  error?: string;
  scoredAt?: string;
}

export type SuggestionJobStatus =
  | "queued"
  | "running"
  | "awaiting_clarification"
  | "succeeded"
  | "failed";

export interface ClarificationSummary {
  status: "not_needed" | "pending" | "answered" | string;
  question?: string | null;
  reason?: string | null;
  answer?: string | null;
  answeredAt?: string | null;
}

export interface CreatedSuggestionJob {
  jobId: string;
  postId: string;
  status: SuggestionJobStatus;
}

export interface SuggestionRunSummary {
  suggestion: string | null;
  rationale: string | null;
  category: string | null;
}

export interface SuggestionJobResult {
  jobId: string;
  postId: string;
  status: SuggestionJobStatus;
  error: string | null;
  run: SuggestionRunSummary | null;
  clarification: ClarificationSummary | null;
}

export interface ClarificationCheckpointInput {
  analysis: unknown;
  clarification: ClarificationSummary;
  steps: unknown[];
  retrievalShortlist?: unknown;
}

export interface JobCheckpoint {
  analysis: unknown;
  steps: unknown[];
  retrievalShortlist?: unknown;
}

export interface ResumedSuggestionJob {
  jobId: string;
  post: PostInput;
  checkpoint: JobCheckpoint;
  clarification: ClarificationSummary;
}

export interface SuggestionResultInput {
  suggestion: string;
  rationale: string;
  category?: string;
  coreSubject?: string;
  appliedPlaybook?: string;
  valueHook?: string;
  voiceCheck?: string;
}

export interface SaveSuggestionRunInput {
  id: string;
  jobId?: string;
  postId: string;
  post: PostInput;
  result: SuggestionResultInput;
  steps: unknown[];
  createdAt: string;
}

export interface SavedSuggestionRun extends SaveSuggestionRunInput {
  jobId: string;
}
