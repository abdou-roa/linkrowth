import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Drafts the comment from the post, the analysis, and the user context using the
 * playbook the analyzer selected. Intended to run on a strong model.
 * Will fill state: { draft }.
 */
export const drafterStep: Step = {
  name: "draft",
  async run() {
    throw new Error("drafter step is not implemented yet");
  },
};
