import type { LlmRequest } from "../llm/types";
import type { EngageResult, Post, UserContext } from "../core/types";

/**
 * Record of a single reasoning step, persisted into suggestion_runs.steps.
 * Lives here (the lowest reasoning layer) so both agents/ and persistence/ can
 * import it without the dependency arrows pointing upward.
 */
export interface ReasoningStep {
  name: string;
  status: "completed" | "failed";
  summary?: string;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Scaffold for the multi-step pipeline. These interfaces define the contract
// the steps/ files and agents/multiStepEngage.ts will implement. No step logic
// is written yet.
// ---------------------------------------------------------------------------

/** Injected LLM entry point, so steps stay testable and provider-agnostic. */
export type LlmCall = (request: LlmRequest) => Promise<string>;

export interface DraftArtifact {
  suggestion: string;
  valueHook?: string;
  appliedPlaybook?: string;
}

export interface CritiqueArtifact {
  pass: boolean;
  issues: string[];
  voiceCheck?: string;
}

/** The blackboard threaded through a multi-step run; each step fills its slot. */
export interface EngageState {
  post: Post;
  context?: UserContext;
  category?: string;
  coreSubject?: string;
  draft?: DraftArtifact;
  critique?: CritiqueArtifact;
  attempts: number;
  result?: EngageResult;
}

export interface StepDeps {
  call: LlmCall;
}

export interface StepResult {
  /** Patch merged into EngageState after the step runs. */
  patch: Partial<EngageState>;
  /** Persistence record for this step (timestamps added by the runner). */
  record: Omit<ReasoningStep, "startedAt" | "completedAt">;
}

export interface Step {
  readonly name: string;
  run(state: EngageState, deps: StepDeps): Promise<StepResult>;
}
