import type { ReasoningStep } from "../agents/types";
import type { EngageResult, Post } from "../types";

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
