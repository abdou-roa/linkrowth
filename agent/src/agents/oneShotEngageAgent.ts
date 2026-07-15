import { call } from "../llm";
import { buildEngagePrompt } from "../prompts";
import type { EngageResult } from "../types";
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

function syntheticStepsFromResult(result: EngageResult): ReasoningStep[] {
  const completedAt = nowIso();
  const startedAt = completedAt;
  const steps: ReasoningStep[] = [];

  if (result.category) {
    steps.push({
      name: "classify",
      status: "completed",
      summary: result.category,
      output: {
        category: result.category,
        coreSubject: result.coreSubject,
      },
      startedAt,
      completedAt,
    });
  }

  if (result.appliedPlaybook) {
    steps.push({
      name: "select_playbook",
      status: "completed",
      summary: result.appliedPlaybook,
      output: { appliedPlaybook: result.appliedPlaybook },
      startedAt,
      completedAt,
    });
  }

  if (result.valueHook) {
    steps.push({
      name: "value_hook",
      status: "completed",
      summary: result.valueHook,
      output: { valueHook: result.valueHook },
      startedAt,
      completedAt,
    });
  }

  if (result.voiceCheck) {
    steps.push({
      name: "voice_check",
      status: "completed",
      summary: result.voiceCheck,
      output: { voiceCheck: result.voiceCheck },
      startedAt,
      completedAt,
    });
  }

  steps.push({
    name: "draft",
    status: "completed",
    summary: "Suggestion and rationale produced",
    output: {
      suggestion: result.suggestion,
      rationale: result.rationale,
    },
    startedAt,
    completedAt,
  });

  return steps;
}

export class OneShotEngageAgent implements Agent {
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
      steps: [engageStep, ...syntheticStepsFromResult(result)],
    };
  }
}

export const oneShotEngageAgent = new OneShotEngageAgent();
