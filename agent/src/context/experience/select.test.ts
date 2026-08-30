import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceArtifact, RankedArtifact } from "./types";
import { evaluateHits, mergeProofPoints, selectClaimableHits } from "./select";

const artifact = (
  id: string,
  line: string,
  extra: Partial<ExperienceArtifact> = {}
): ExperienceArtifact => ({
  id,
  sourceCandidateId: id,
  source: "local_git",
  repo: "linkrowth",
  implementationDate: "2026-08-25T00:00:00Z",
  title: line,
  domains: ["agents"],
  stack: ["TypeScript"],
  problem: "p",
  approach: "a",
  tradeoff: "",
  claimableLine: line,
  confidence: "high",
  shareability: "public",
  paths: ["agent/src/core/engage.ts"],
  ...extra,
});

const hit = (
  score: number,
  line: string,
  extra: Partial<ExperienceArtifact> = {}
): RankedArtifact => ({
  score,
  artifact: artifact(line, line, extra),
});

describe("selectClaimableHits", () => {
  it("drops private, low-confidence, and below-threshold hits", () => {
    const selected = selectClaimableHits(
      [
        hit(0.9, "good public high"),
        hit(0.85, "private secret", { shareability: "private" }),
        hit(0.8, "low confidence", { confidence: "low" }),
        hit(0.1, "weak score"),
        hit(0.7, "anonymized ok", { shareability: "anonymized", confidence: "medium" }),
      ],
      { minScore: 0.3, k: 5 }
    );

    assert.deepEqual(
      selected.map((h) => h.artifact.claimableLine),
      ["good public high", "anonymized ok"]
    );
  });

  it("caps at k after filters", () => {
    const selected = selectClaimableHits(
      [hit(0.9, "a"), hit(0.8, "b"), hit(0.7, "c")],
      { minScore: 0.3, k: 2 }
    );
    assert.equal(selected.length, 2);
    assert.equal(selected[0]?.artifact.claimableLine, "a");
  });
});

describe("evaluateHits", () => {
  it("annotates each hit with a keep/drop reason (single source of truth)", () => {
    const decisions = evaluateHits(
      [
        hit(0.9, "good public high"),
        hit(0.85, "private secret", { shareability: "private" }),
        hit(0.8, "low confidence", { confidence: "low" }),
        hit(0.1, "weak score"),
        hit(0.7, "empty claim", { claimableLine: "   " }),
      ],
      { minScore: 0.3, k: 5 }
    );

    assert.deepEqual(
      decisions.map((d) => ({ selected: d.selected, dropReason: d.dropReason })),
      [
        { selected: true, dropReason: undefined },
        { selected: false, dropReason: "shareability" },
        { selected: false, dropReason: "confidence" },
        { selected: false, dropReason: "min_score" },
        { selected: false, dropReason: "empty_claim" },
      ]
    );
    assert.deepEqual(
      decisions.map((d) => d.rank),
      [0, 1, 2, 3, 4]
    );
  });

  it("marks survivors beyond k as over_k without dropping earlier ones", () => {
    const decisions = evaluateHits([hit(0.9, "a"), hit(0.8, "b"), hit(0.7, "c")], {
      minScore: 0.3,
      k: 2,
    });
    assert.deepEqual(
      decisions.map((d) => d.dropReason),
      [undefined, undefined, "over_k"]
    );
  });

  it("stays consistent with selectClaimableHits", () => {
    const hits = [
      hit(0.9, "a"),
      hit(0.85, "private", { shareability: "private" }),
      hit(0.7, "b"),
    ];
    const options = { minScore: 0.3, k: 5 };
    const fromEvaluate = evaluateHits(hits, options)
      .filter((d) => d.selected)
      .map((d) => d.hit.artifact.claimableLine);
    const fromSelect = selectClaimableHits(hits, options).map(
      (h) => h.artifact.claimableLine
    );
    assert.deepEqual(fromEvaluate, fromSelect);
  });
});

describe("mergeProofPoints", () => {
  it("dedupes case-insensitively and preserves existing order first", () => {
    assert.deepEqual(
      mergeProofPoints(["Already have this", "Static point"], [
        "already have this",
        "Retrieved point",
      ]),
      ["Already have this", "Static point", "Retrieved point"]
    );
  });

  it("handles undefined existing proof points", () => {
    assert.deepEqual(mergeProofPoints(undefined, ["Only retrieved"]), ["Only retrieved"]);
  });
});
