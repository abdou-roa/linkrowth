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

/** The single multi-step engagement pipeline. */
export interface Agent {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
