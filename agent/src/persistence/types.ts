import type { EngageResult, Post } from "../core/types";

export interface ReasoningStep {
  name: string;
  status: "completed" | "failed";
  summary?: string;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string;
}

/** Persisted engage run aligned with helpers/schema.sql `suggestion_runs`. */
export interface RunRecord {
  id: string;
  /** FK to suggestion_jobs. Omitted on CLI save → repository creates a terminal job. */
  jobId?: string;
  postId: string;
  agentId: string;
  post: Post;
  result: EngageResult;
  steps: ReasoningStep[];
  createdAt: string;
}

export interface RunRepository {
  save(run: RunRecord): Promise<RunRecord>;
}
