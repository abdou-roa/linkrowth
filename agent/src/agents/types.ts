import type { EngageResult, Post, UserContext } from "../core/types";
import type { ReasoningStep } from "../steps/types";

export interface AgentRunInput {
  post: Post;
  context: UserContext;
}

export interface AgentRunResult {
  agentId: string;
  result: EngageResult;
  steps: ReasoningStep[];
}

/**
 * A named engagement pipeline. One-shot is a single-step agent; multi-step
 * composes several steps. Selected by the registry and run by persistence.
 */
export interface Agent {
  readonly id: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
