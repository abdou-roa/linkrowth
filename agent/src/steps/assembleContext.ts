import type { Step } from "./types";

/**
 * SCAFFOLD — not implemented.
 * Assembles the UserContext for this post. No LLM call. This is the RAG seam
 * (see docs/RAG-PIPELINE.md): today it would return the statically loaded
 * context; later it retrieves per-post / per-category material.
 * Will fill state: { context }.
 */
export const assembleContextStep: Step = {
  name: "assemble_context",
  async run() {
    throw new Error("assembleContext step is not implemented yet");
  },
};
