import { call } from "../llm";
import { analyzerStep } from "../steps/analyzer";
import { drafterStep } from "../steps/drafter";
import { refinerStep } from "../steps/refiner";
import type { EngageResult } from "../core/types";
import type { EngageState, ReasoningStep, Step } from "../steps/types";
import { needsClarification } from "../steps/types";
import type {
  Agent,
  AgentDependencies,
  AgentRunInput,
  AgentRunResult,
} from "./types";

export const MULTI_STEP_ENGAGE_AGENT_ID = "multi_step_engage";

/** Max draft+refine cycles before accepting the current draft. */
const MAX_REFINE_ATTEMPTS = 2;

/** Factory function to initialize clean state per execution. */
function createInitialState(input: AgentRunInput): EngageState {
  return {
    post: input.post,
    context: input.context,
    draft: undefined,
    analysis: input.analysis,
    clarification: input.clarification,
    feedbackHistory: [],
    attempts: 1,
    status: "in_progress",
    isApproved: undefined,
    result: undefined,
    steps: [],
  };
}

function finalizeResult(state: EngageState): EngageResult {
  if (state.result) return state.result;

  return {
    suggestion: state.draft?.suggestion ?? "",
    rationale: state.draft?.rationale ?? "",
    category: state.analysis?.category,
    coreSubject: state.analysis?.coreThesis,
  };
}

export class MultiStepEngageAgent implements Agent {
  readonly id = MULTI_STEP_ENGAGE_AGENT_ID;

  constructor(private readonly deps: AgentDependencies) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // 1. Initialize state scoped strictly to this execution run
    let state = createInitialState(input);

    // 2. Analyze — or resume from a checkpoint when clarification is already answered
    const resumingWithAnswer =
      Boolean(input.analysis) && input.clarification?.status === "answered";

    if (!resumingWithAnswer) {
      state = await this.executeStep(analyzerStep, state);

      // HITL gate: stop before drafting until the user answers
      if (needsClarification(state.clarification)) {
        return {
          agentId: this.id,
          status: "awaiting_clarification",
          steps: state.steps,
          clarification: state.clarification,
          analysis: state.analysis,
        };
      }
    } else {
      // Resume: keep status in_progress and continue at the drafter
      state.status = "in_progress";
    }

    // 3. Draft initial comment from the analysis (+ answered clarification)
    state = await this.executeStep(drafterStep, state);

    // 4. Refine ↔ redraft until approved or attempts are exhausted
    while (state.attempts <= MAX_REFINE_ATTEMPTS) {
      state = await this.executeStep(refinerStep, state);

      if (state.isApproved || state.status === "ready_for_review") {
        break;
      }

      // Rejected: bump attempt and redraft with updated feedbackHistory
      state.attempts += 1;
      if (state.attempts <= MAX_REFINE_ATTEMPTS) {
        state = await this.executeStep(drafterStep, state);
      }
    }

    return {
      agentId: this.id,
      status: "completed",
      result: finalizeResult(state),
      steps: state.steps,
      clarification: state.clarification,
      analysis: state.analysis,
    };
  }

  /** Helper to execute a step, patch state immutably, and log reasoning steps. */
  private async executeStep(
    step: Step,
    currentState: EngageState
  ): Promise<EngageState> {
    const startedAt = new Date().toISOString();
    const stepResult = await step.run(currentState, this.deps);
    const completedAt = new Date().toISOString();

    const stepRecord: ReasoningStep = {
      ...stepResult.record,
      startedAt,
      completedAt,
    };

    return {
      ...currentState,
      ...stepResult.patch,
      steps: [...currentState.steps, stepRecord],
    };
  }
}

export const multiStepEngageAgent = new MultiStepEngageAgent({ call });
