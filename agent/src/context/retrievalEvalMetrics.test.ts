import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateRetrievalEvalMetrics } from "./retrievalEvalMetrics";

describe("calculateRetrievalEvalMetrics", () => {
  it("reports ranking, safety, and abstention metrics deterministically", () => {
    const metrics = calculateRetrievalEvalMetrics([
      {
        id: "match",
        expectedArtifactIds: ["right"],
        candidateArtifactIds: ["wrong", "right"],
        selectedArtifactIds: ["right"],
        unsafeArtifactIds: ["private"],
        noMatch: false,
        angleMismatch: true,
        evidenceScores: { right: 0.8, wrong: 0.2 },
      },
      {
        id: "no-match",
        expectedArtifactIds: [],
        candidateArtifactIds: [],
        selectedArtifactIds: [],
        unsafeArtifactIds: [],
        noMatch: true,
      },
    ]);

    assert.equal(metrics.candidateRecallAtN, 1);
    assert.equal(metrics.mrr, 0.5);
    assert.ok(metrics.ndcg > 0.6 && metrics.ndcg < 0.7);
    assert.equal(metrics.finalPrecisionAtK, 1);
    assert.equal(metrics.angleConditionedPrecision, 1);
    assert.ok(Math.abs(metrics.evidenceSeparation - 0.6) < 1e-9);
    assert.equal(metrics.safetyPassRate, 1);
    assert.equal(metrics.abstentionAccuracy, 1);
  });
});
