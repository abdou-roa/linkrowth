import { engage } from "../core/engage";
import { withTrace } from "../observability";
import type { ReasoningStep } from "../steps/types";
import type { Agent, AgentRunInput, AgentRunResult } from "./types";

export const ONE_SHOT_ENGAGE_AGENT_ID = "one_shot_engage";

/**
 * The default engagement pipeline: a single prompt that classifies, applies the
 * playbook, calibrates voice, and drafts in one call. Wraps the pure core so the
 * one-step and multi-step agents share the same Agent contract.
 */
class OneShotEngageAgent implements Agent {
  readonly id = ONE_SHOT_ENGAGE_AGENT_ID;

  async run({ post, context }: AgentRunInput): Promise<AgentRunResult> {
    return withTrace(
      "engage.step.engage_oneshot",
      { "linkrowth.step": "engage_oneshot", "linkrowth.agent_id": this.id },
      async (span) => {
        const startedAt = new Date().toISOString();
        const result = await engage(post, context);
        const completedAt = new Date().toISOString();

        span.setMetadata({
          "linkrowth.category": result.category ?? "",
        });
        if (result.suggestion) {
          span.setResult(result.suggestion);
        }

        const step: ReasoningStep = {
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
          steps: [step],
        };
      }
    );
  }
}

export const oneShotEngageAgent = new OneShotEngageAgent();
