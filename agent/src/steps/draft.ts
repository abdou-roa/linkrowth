import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Drafts the comment from the post, category, and context using the matching
 * playbook. Intended to run on a strong model.
 * Will fill state: { draft }.
 */
export const draftStep: Step = {
  name: "draft",
  async run() {
    throw new Error("draft step is not implemented yet");
  },
};
