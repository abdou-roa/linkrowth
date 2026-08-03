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

export type AuthorSeniority = "ic" | "leadership" | "founder" | "unknown";

export type PostTone =
  | "celebratory"
  | "reflective"
  | "frustrated"
  | "analytical"
  | "provocative"
  | "neutral";

/** Inferred from the author's LinkedIn headline only — no profile fetch. */
export interface AuthorProfile {
  isTechnical: boolean;
  seniority: AuthorSeniority;
}

export interface PivotStrategy {
  acknowledgedPoint: string;
  insightToInject: string;
}

export type SuggestedLength = "short" | "standard" | "extended";
export type TechnicalDepth = "high" | "accessible";

/** Tells the Drafter how much to write and at what vocabulary level. */
export interface ResponseParameters {
  suggestedLength: SuggestedLength;
  technicalDepth: TechnicalDepth;
}

/** Analyzer output: structural analysis of the post before any drafting. */
export interface AnalysisArtifact {
  category: PostCategory;
  coreThesis: string;
  tone: PostTone;
  authorProfile: AuthorProfile;
  /** The exact question posed to readers, if the post asks one directly. */
  postQuestion: string | null;
  /** Empty array for non-technical posts. */
  unspokenTradeoffs: string[];
  /** Sensitive topics (layoffs, grief, competitor bashing, politics, etc.) to handle carefully. Empty when none. */
  riskFlags: string[];
  pivotStrategy: PivotStrategy;
  responseParameters: ResponseParameters;
}

/** Drafter / refiner output: the candidate comment. */
export interface DraftArtifact {
  suggestion: string;
  rationale?: string;
}

/**
 * Dimensions the refiner reports on. Only "fabrication" and "length" send a
 * draft back to the drafter; the rest are recorded for human review.
 */
export type FindingDimension =
  | "fabrication"
  | "length"
  | "strategyFidelity"
  | "questionObligation"
  | "nicheSignature"
  | "riskHandling"
  | "voiceMatch";

export interface CritiqueFinding {
  dimension: FindingDimension;
  /** Verbatim span from the draft, so a redraft knows exactly what to change. */
  excerpt?: string;
  /** Directive ("drop the 40% figure"), never an evaluation ("feels unsupported"). */
  instruction: string;
}

/** Refiner output: a judgement on the draft. The refiner never rewrites. */
export interface CritiqueArtifact {
  verdict: "approved" | "rejected";
  findings: CritiqueFinding[];
}

/**
 * A rejected draft paired with why it was rejected. Keeping the draft (not just
 * the notes) lets a redraft see the exact wording it must not repeat, and lets
 * the runner pick the least-flawed draft when the attempt budget runs out.
 */
export interface DraftAttempt {
  attempt: number;
  draft: DraftArtifact;
  findings: CritiqueFinding[];
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
  /** Rejected drafts and their critiques, accumulated across redraft cycles. */
  feedbackHistory: DraftAttempt[];
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
