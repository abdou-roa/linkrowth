import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Classifies the post into Technical / Achievement / Informal and extracts the
 * core subject. Intended to run on a cheap model.
 * Will fill state: { category, coreSubject }.
 */
export const classifyStep: Step = {
  name: "classify",
  async run() {
    throw new Error("classify step is not implemented yet");
  },
};
