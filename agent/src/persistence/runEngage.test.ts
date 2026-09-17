import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRetrievalPipeline } from "./runEngage";

describe("parseRetrievalPipeline", () => {
  it("defaults to the legacy path", () => {
    assert.equal(parseRetrievalPipeline(undefined), "legacy");
    assert.equal(parseRetrievalPipeline(""), "legacy");
    assert.equal(parseRetrievalPipeline("unexpected"), "legacy");
  });

  it("accepts analysis-aware aliases", () => {
    assert.equal(parseRetrievalPipeline("analysis_aware"), "analysis_aware");
    assert.equal(parseRetrievalPipeline("analysis-aware"), "analysis_aware");
    assert.equal(parseRetrievalPipeline("4"), "analysis_aware");
  });
});
