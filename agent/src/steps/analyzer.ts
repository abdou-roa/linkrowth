import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Analyzes the post: classifies it (Technical / Achievement / Informal),
 * extracts the core subject, and picks the value hook / playbook to pursue.
 * Will fill state: { analysis }.
 */
export const analyzerStep: Step = {
  name: "analyze",
  async run() {
    throw new Error("analyzer step is not implemented yet");
  },
};
