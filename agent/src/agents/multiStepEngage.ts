import { classifyStep } from "../steps/classify";
import { assembleContextStep } from "../steps/assembleContext";
import { draftStep } from "../steps/draft";
import { critiqueStep } from "../steps/critique";
import { refineStep } from "../steps/refine";
import type { Agent, AgentRunInput, AgentRunResult } from "./types";

export const MULTI_STEP_ENGAGE_AGENT_ID = "multi_step_engage";

/** Max critique → refine cycles before accepting the current draft. */
const MAX_REFINE_ATTEMPTS = 2;

/**
 * SCAFFOLD — not implemented.
 *
 * Composes the reasoning steps into the engage pipeline:
 *
 *   classify → assembleContext → draft → critique ↺ refine → finalize
 *
 * Intended controller shape (imperative, bounded loop):
 *   1. run classify, assembleContext, draft (linear), merging each patch
 *   2. run critique
 *   3. while !critique.pass && attempts < MAX_REFINE_ATTEMPTS: run refine, re-critique
 *   4. finalize EngageState.draft → EngageResult
 *   5. return { agentId, result, steps } with one ReasoningStep per step run
 *
 * Step bodies (prompt + parse) and this controller are the next unit of work.
 */
class MultiStepEngageAgent implements Agent {
  readonly id = MULTI_STEP_ENGAGE_AGENT_ID;

  // Declared here so the pipeline order is visible; wiring lands with the impl.
  private readonly steps = [
    classifyStep,
    assembleContextStep,
    draftStep,
    critiqueStep,
    refineStep,
  ];

  async run(_input: AgentRunInput): Promise<AgentRunResult> {
    void this.steps;
    void MAX_REFINE_ATTEMPTS;
    throw new Error("multi_step_engage agent is not implemented yet");
  }
}

export const multiStepEngageAgent = new MultiStepEngageAgent();
