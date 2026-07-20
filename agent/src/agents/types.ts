import type { EngageResult, Post, UserContext } from "../types";

export interface ReasoningStep {
  name: string;
  status: "completed" | "failed";
  summary?: string;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface AgentRunInput {
  post: Post;
  context: UserContext;
}

export interface AgentRunResult {
  agentId: string;
  result: EngageResult;
  steps: ReasoningStep[];
}

export interface Agent {
  readonly id: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
