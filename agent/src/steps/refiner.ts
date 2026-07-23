import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Self-reviews the draft against the anti-AI filter and voice guardrails, then
 * rewrites it to resolve any issues. Bounded by EngageState.attempts.
 * Will fill state: { draft } (refined), { result } (finalized), attempts++.
 */
export const refinerStep: Step = {
  name: "refine",
  async run() {
    throw new Error("refiner step is not implemented yet");
  },
};
