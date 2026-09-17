import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeClarificationCheckpoint } from "./suggestionJobs";

describe("serializeClarificationCheckpoint", () => {
  it("persists the retrieval shortlist alongside analysis and steps", () => {
    const shortlist = {
      version: 1,
      status: "ready",
      postFingerprint: "post",
      candidates: [{ artifact: { id: "experience-1" } }],
    };
    const serialized = serializeClarificationCheckpoint({
      analysis: { coreThesis: "thesis" },
      clarification: {
        status: "pending",
        question: "Which database?",
      },
      steps: [{ name: "analyzer" }],
      retrievalShortlist: shortlist,
    });

    assert.deepEqual(JSON.parse(serialized), {
      analysis: { coreThesis: "thesis" },
      steps: [{ name: "analyzer" }],
      retrievalShortlist: shortlist,
    });
  });
});
