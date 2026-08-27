import type { EngageResult, Post, UserContext } from "../core/types";
import type {
  AnalysisArtifact,
  HumanClarification,
  LlmCall,
  ReasoningStep,
} from "../steps/types";

export interface AgentRunInput {
  post: Post;
  context: UserContext;
  /**
   * Optional prior clarification (e.g. resume after the user answered).
   * When status is "answered" with a prior analysis, the multi-step agent
   * skips re-analysis and the HITL pause, and continues at the drafter.
   */
  clarification?: HumanClarification;
  /** Analysis checkpoint used with an answered clarification on resume. */
  analysis?: AnalysisArtifact;
}

export type AgentRunStatus = "completed" | "awaiting_clarification";

export interface AgentRunResult {
  agentId: string;
  status: AgentRunStatus;
  /** Present when status is "completed". */
  result?: EngageResult;
  steps: ReasoningStep[];
  /** Present when status is "awaiting_clarification" (and often on completed runs). */
  clarification?: HumanClarification;
  /** Analysis checkpoint so a paused run can resume at the drafter. */
  analysis?: AnalysisArtifact;
}

/** Injected runtime deps for agents that compose LLM-backed steps. */
export interface AgentDependencies {
  call: LlmCall;
}

/**
 * A named engagement pipeline. One-shot is a single-step agent; multi-step
 * composes several steps. Selected by the registry and run by persistence.
 */
export interface Agent {
  readonly id: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
