import { analyzerStep } from "../steps/analyzer";
import { drafterStep } from "../steps/drafter";
import { refinerStep } from "../steps/refiner";
import type { Agent, AgentRunInput, AgentRunResult } from "./types";

export const MULTI_STEP_ENGAGE_AGENT_ID = "multi_step_engage";

/** Max refiner cycles before accepting the current draft. */
const MAX_REFINE_ATTEMPTS = 2;

/**
 * SCAFFOLD — not implemented.
 *
 * Composes the reasoning steps into the engage pipeline:
 *
 *   analyze → draft → refine ↺ → finalize
 *
 * Intended controller shape (imperative, bounded loop):
 *   1. run analyzer, then drafter (linear), merging each patch
 *   2. run refiner (self-review + rewrite)
 *   3. while refiner requests another pass && attempts < MAX_REFINE_ATTEMPTS: run refiner again
 *   4. finalize EngageState.draft → EngageResult
 *   5. return { agentId, result, steps } with one ReasoningStep per step run
 *
 * Context is supplied by persistence (loadUserContext); the RAG seam stays in
 * context/, not as a step. Step bodies and this controller are the next work.
 */
class MultiStepEngageAgent implements Agent {
  readonly id = MULTI_STEP_ENGAGE_AGENT_ID;

  // Declared here so the pipeline order is visible; wiring lands with the impl.
  private readonly steps = [analyzerStep, drafterStep, refinerStep];

  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    void this.steps;
    void MAX_REFINE_ATTEMPTS;
    throw new Error("multi_step_engage agent is not implemented yet");
  }
}

export const multiStepEngageAgent = new MultiStepEngageAgent();
