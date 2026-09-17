import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResumedSuggestionJob } from "@linkrowth/db";
import { buildClarificationResumeOptions } from "./processSuggestionJob";

describe("buildClarificationResumeOptions", () => {
  it("propagates checkpointed analysis and retrieval shortlist", () => {
    const shortlist = {
      version: 1,
      status: "ready",
      postFingerprint: "post",
    };
    const resumed = {
      jobId: "job-1",
      clarification: {
        status: "pending",
        question: "Which database?",
      },
      checkpoint: {
        analysis: { coreThesis: "thesis" },
        steps: [],
        retrievalShortlist: shortlist,
      },
    } as unknown as ResumedSuggestionJob;

    const options = buildClarificationResumeOptions(resumed, "Postgres");

    assert.equal(options.jobId, "job-1");
    assert.equal(options.skipClaim, true);
    assert.equal(options.clarification.answer, "Postgres");
    assert.strictEqual(options.analysis, resumed.checkpoint.analysis);
    assert.strictEqual(options.retrievalShortlist, shortlist);
  });
});
