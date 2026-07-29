import {
  ONE_SHOT_ENGAGE_AGENT_ID,
  oneShotEngageAgent,
} from "./oneShotEngage";
import {
  MULTI_STEP_ENGAGE_AGENT_ID,
  multiStepEngageAgent,
} from "./multiStepEngage";
import type { Agent } from "./types";

const agents = new Map<string, Agent>([
  [ONE_SHOT_ENGAGE_AGENT_ID, oneShotEngageAgent],
  [MULTI_STEP_ENGAGE_AGENT_ID, multiStepEngageAgent],
]);

export const DEFAULT_AGENT_ID = ONE_SHOT_ENGAGE_AGENT_ID;

/** Resolve an agent by id, falling back to LINKROWTH_AGENT then the default. */
export function getAgent(id?: string): Agent {
  const agentId = id ?? process.env.LINKROWTH_AGENT ?? DEFAULT_AGENT_ID;
  const agent = agents.get(agentId);
  if (!agent) {
    throw new Error(
      `Unknown agent "${agentId}". Available: ${[...agents.keys()].join(", ")}`
    );
  }
  return agent;
}
