import type { EngageResult, Post } from "../core/types";
import type { ReasoningStep } from "../steps/types";

export type { ReasoningStep };

/** Persisted engage run aligned with @linkrowth/db `suggestion_runs`. */
export interface RunRecord {
  id: string;
  /** FK to suggestion_jobs. Omitted on CLI save → repository creates a terminal job. */
  jobId?: string;
  postId: string;
  post: Post;
  result: EngageResult;
  steps: ReasoningStep[];
  createdAt: string;
}

export interface RunRepository {
  save(run: RunRecord): Promise<RunRecord>;
}
