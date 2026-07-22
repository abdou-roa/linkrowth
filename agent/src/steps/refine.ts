import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Rewrites the draft to resolve the issues raised by critique. Bounded by
 * EngageState.attempts in the multi-step controller.
 * Will fill state: { draft } (improved) and increment attempts.
 */
export const refineStep: Step = {
  name: "refine",
  async run() {
    throw new Error("refine step is not implemented yet");
  },
};
