import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserContext } from "../core/types";
import type { AnalysisArtifact, EngageState, Step } from "../steps/types";
import { MultiStepEngageAgent } from "./multiStepEngage";

const analysis: AnalysisArtifact = {
  category: "technical",
  coreThesis: "Durability needs acknowledgement.",
  tone: "analytical",
  authorProfile: { isTechnical: true, seniority: "ic" },
  postQuestions: [],
  unspokenTradeoffs: [],
  riskFlags: [],
  pivotStrategy: {
    acknowledgedPoint: "Retries matter.",
    insightDirection: "Use claimed rows.",
  },
  responseParameters: {
    technicalDepth: "high",
    suggestedLength: "short",
  },
};
const context: UserContext = {
  niche: "engineering",
  positioning: "operator",
  targetAudience: "technical leaders",
  proofPoints: [],
};

function step(
  name: string,
  run: (state: EngageState) => Partial<EngageState>
): Step {
  return {
    name,
    async run(state) {
      return {
        patch: run(state),
        record: { name, status: "completed" },
      };
    },
  };
}

describe("MultiStepEngageAgent context synchronization", () => {
  it("does not finalize context or draft while clarification is pending", async () => {
    let prepared = false;
    let drafted = false;
    const agent = new MultiStepEngageAgent(
      { call: async () => "" },
      {
        analyzer: step("analyzer", () => ({
          analysis,
          clarification: {
            status: "pending",
            question: "Which database?",
          },
        })),
        drafter: step("drafter", () => {
          drafted = true;
          return { draft: { suggestion: "draft" } };
        }),
        refiner: step("refiner", () => ({
          isApproved: true,
          status: "ready_for_review",
        })),
      }
    );

    const outcome = await agent.run({
      post: { text: "post" },
      context,
      prepareContext: async () => {
        prepared = true;
        return context;
      },
    });

    assert.equal(outcome.status, "awaiting_clarification");
    assert.equal(prepared, false);
    assert.equal(drafted, false);
  });

  it("finalizes context after analysis and before the first draft", async () => {
    const order: string[] = [];
    const agent = new MultiStepEngageAgent(
      { call: async () => "" },
      {
        analyzer: step("analyzer", () => {
          order.push("analyze");
          return { analysis };
        }),
        drafter: step("drafter", (state) => {
          order.push("draft");
          assert.deepEqual(state.context?.proofPoints, ["injected"]);
          return { draft: { suggestion: "draft" } };
        }),
        refiner: step("refiner", () => ({
          isApproved: true,
          status: "ready_for_review",
        })),
      }
    );

    const outcome = await agent.run({
      post: { text: "post" },
      context,
      prepareContext: async ({ context: base }) => {
        order.push("prepare");
        return { ...base, proofPoints: ["injected"] };
      },
    });

    assert.equal(outcome.status, "completed");
    assert.deepEqual(order, ["analyze", "prepare", "draft"]);
  });

  it("uses checkpointed analysis and the authoritative answer on resume", async () => {
    let analyzerCalled = false;
    let observedAnswer: string | undefined;
    const agent = new MultiStepEngageAgent(
      { call: async () => "" },
      {
        analyzer: step("analyzer", () => {
          analyzerCalled = true;
          return {};
        }),
        drafter: step("drafter", () => ({
          draft: { suggestion: "draft" },
        })),
        refiner: step("refiner", () => ({
          isApproved: true,
          status: "ready_for_review",
        })),
      }
    );

    await agent.run({
      post: { text: "post" },
      context,
      analysis,
      clarification: {
        status: "answered",
        question: "Which database?",
        answer: "Postgres",
      },
      prepareContext: async ({ clarification, context: base }) => {
        observedAnswer =
          clarification?.status === "answered"
            ? clarification.answer
            : undefined;
        return base;
      },
    });

    assert.equal(analyzerCalled, false);
    assert.equal(observedAnswer, "Postgres");
  });
});
