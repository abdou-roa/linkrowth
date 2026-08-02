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

export type PostCategory = "technical" | "achievement" | "informal";

/** Inferred from the author's LinkedIn headline only — no profile fetch. */
export interface AuthorProfile {
  isTechnical: boolean;
}

export interface PivotStrategy {
  acknowledgedPoint: string;
  insightToInject: string;
}

/** Analyzer output: structural analysis of the post before any drafting. */
export interface AnalysisArtifact {
  category: PostCategory;
  coreThesis: string;
  authorProfile: AuthorProfile;
  /** Empty array for non-technical posts. */
  unspokenTradeoffs: string[];
  pivotStrategy: PivotStrategy;
}

/** Drafter / refiner output: the candidate comment. */
export interface DraftArtifact {
  suggestion: string;
  rationale?: string;
}

export type EngageRunStatus = "in_progress" | "ready_for_review";

/**
 * The blackboard threaded through a multi-step run; each step fills its slot.
 * Pipeline: analyzer → drafter → refiner ↺ drafter. Context is supplied by
 * persistence (loadUserContext); the RAG seam stays in context/, not as a step.
 */
export interface EngageState {
  post: Post;
  context?: UserContext;
  analysis?: AnalysisArtifact;
  draft?: DraftArtifact;
  /** Refiner notes accumulated across reject → redraft cycles. */
  feedbackHistory: string[];
  attempts: number;
  status: EngageRunStatus;
  isApproved?: boolean;
  result?: EngageResult;
  steps: ReasoningStep[];
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
