import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Self-reviews the draft against the anti-AI filter and voice guardrails,
 * deciding whether to accept or send back for a refine pass. Intended to run on
 * a cheap model.
 * Will fill state: { critique }.
 */
export const critiqueStep: Step = {
  name: "critique",
  async run() {
    throw new Error("critique step is not implemented yet");
  },
};
