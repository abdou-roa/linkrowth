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
  /** Direct command telling the drafter what argument/stance to inject — not final comment prose. */
  insightDirection: string;
}

export type SuggestedLength = "short" | "standard" | "extended";
export type TechnicalDepth = "high" | "accessible";

/** Whether the drafter should address this extracted question. */
export type QuestionReplyDecision = "answer" | "omit";

/** A question found in the post, with a reply/omit classification. */
export interface PostQuestion {
  /** Exact or lightly paraphrased question text from the post. */
  text: string;
  /** "answer" = genuine reader ask the comment should address; "omit" = rhetorical/stylistic/etc. */
  decision: QuestionReplyDecision;
  /** One-line rationale for the decision. */
  reason: string;
}

/** Vocabulary register first; comment budget follows how deep the insight must go. */
export interface ResponseParameters {
  technicalDepth: TechnicalDepth;
  suggestedLength: SuggestedLength;
}

/** Analyzer output: structural analysis of the post before any drafting. */
export interface AnalysisArtifact {
  category: PostCategory;
  coreThesis: string;
  tone: PostTone;
  authorProfile: AuthorProfile;
  /** Every question found in the post, each classified as answer or omit. Empty when none. */
  postQuestions: PostQuestion[];
  /** Empty array for non-technical posts. */
  unspokenTradeoffs: string[];
  /** Sensitive topics (layoffs, grief, competitor bashing, politics, etc.) to handle carefully. Empty when none. */
  riskFlags: string[];
  pivotStrategy: PivotStrategy;
  responseParameters: ResponseParameters;
}

/**
 * Human-in-the-loop clarification. Kept separate from AnalysisArtifact so
 * inference stays auditable and the user's answer can override it.
 */
export type ClarificationStatus = "not_needed" | "pending" | "answered";

export interface HumanClarification {
  status: ClarificationStatus;
  /** One focused question for the user. Present when status is pending or answered. */
  question?: string;
  /** Why this answer is required for a grounded draft. */
  reason?: string;
  /** Authoritative user answer. Present when status is answered. */
  answer?: string;
  askedAt?: string;
  answeredAt?: string;
}

/** Questions the drafter is obligated to address. */
export function answerableQuestions(analysis: AnalysisArtifact): PostQuestion[] {
  return analysis.postQuestions.filter((q) => q.decision === "answer");
}

/** True when the pipeline must pause for a user answer before drafting. */
export function needsClarification(clarification?: HumanClarification): boolean {
  return clarification?.status === "pending" && Boolean(clarification.question?.trim());
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

export type EngageRunStatus =
  | "in_progress"
  | "awaiting_clarification"
  | "ready_for_review";

/**
 * The blackboard threaded through a multi-step run; each step fills its slot.
 * Pipeline: analyzer → [HITL if needed] → drafter → refiner ↺ drafter.
 * Context is supplied by persistence (loadUserContext + retrieveContext);
 * the RAG seam stays in context/, not as a step.
 */
export interface EngageState {
  post: Post;
  context?: UserContext;
  analysis?: AnalysisArtifact;
  /**
   * Human clarification slot. Filled by the analyzer when a user answer is
   * required; the answer becomes authoritative input for the drafter.
   */
  clarification?: HumanClarification;
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
