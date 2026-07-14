import type { ReasoningStep } from "../agents/types";
import type { EngageResult, Post } from "../types";

export interface RunRecord {
  id: string;
  postId: string;
  agentId: string;
  post: Post;
  result: EngageResult;
  steps: ReasoningStep[];
  createdAt: string;
}

export interface RunRepository {
  save(run: RunRecord): Promise<RunRecord>;
  getById(id: string): Promise<RunRecord | null>;
  list(limit?: number): Promise<RunRecord[]>;
}
