import { call } from "../llm";
import { buildEngagePrompt } from "../prompts";
import { parseEngageResponse } from "./parseEngageResponse";
import type {
  Agent,
  AgentRunInput,
  AgentRunResult,
  ReasoningStep,
} from "./types";

export const ONE_SHOT_ENGAGE_AGENT_ID = "one_shot_engage";

function nowIso(): string {
  return new Date().toISOString();
}

class OneShotEngageAgent implements Agent {
  readonly id = ONE_SHOT_ENGAGE_AGENT_ID;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const startedAt = nowIso();
    const prompt = buildEngagePrompt(input.post, input.context);

    const response = await call(prompt);
    const result = parseEngageResponse(response);
    const completedAt = nowIso();

    const engageStep: ReasoningStep = {
      name: "engage_oneshot",
      status: "completed",
      summary: "Single-prompt engage completed",
      output: result,
      startedAt,
      completedAt,
    };

    return {
      agentId: this.id,
      result,
      steps: [engageStep],
    };
  }
}

export const oneShotEngageAgent = new OneShotEngageAgent();
