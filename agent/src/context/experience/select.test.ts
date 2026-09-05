import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceArtifact, RankedArtifact } from "./types";
import {
  buildCandidateWindow,
  evaluateHits,
  evaluateHybridHits,
  filterInjectableItems,
  isInjectableArtifact,
  mergeProofPoints,
  selectClaimableHits,
} from "./select";

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

describe("isInjectableArtifact", () => {
  it("accepts public/anonymized high/medium with a claimable line", () => {
    assert.equal(isInjectableArtifact(artifact("a", "ok")), true);
    assert.equal(
      isInjectableArtifact(
        artifact("b", "ok", { shareability: "anonymized", confidence: "medium" })
      ),
      true
    );
  });

  it("rejects private, low confidence, and empty claimable lines", () => {
    assert.equal(
      isInjectableArtifact(artifact("p", "secret", { shareability: "private" })),
      false
    );
    assert.equal(
      isInjectableArtifact(artifact("l", "weak", { confidence: "low" })),
      false
    );
    assert.equal(
      isInjectableArtifact(artifact("e", "   ", { claimableLine: "   " })),
      false
    );
  });

  it("filterInjectableItems keeps only injectable indexed rows", () => {
    const items = [
      {
        id: "ok",
        vector: [1],
        situationVector: [1],
        evidenceVector: [1],
        artifact: artifact("ok", "public claim"),
      },
      {
        id: "bad",
        vector: [1],
        situationVector: [1],
        evidenceVector: [1],
        artifact: artifact("bad", "secret", { shareability: "private" }),
      },
    ];
    assert.deepEqual(
      filterInjectableItems(items).map((i) => i.id),
      ["ok"]
    );
  });
});

describe("buildCandidateWindow", () => {
  it("counts only eligible candidates toward the pool cap and retains exclusions", () => {
    const window = buildCandidateWindow(
      [
        hit(0.99, "private", { shareability: "private" }),
        hit(0.98, "low", { confidence: "low" }),
        hit(0.97, "empty", { claimableLine: " " }),
        hit(0.9, "public"),
      ],
      1
    );

    assert.deepEqual(window.eligible.map((candidate) => candidate.artifact.id), ["public"]);
    assert.deepEqual(
      window.entries.map((entry) => ({
        id: entry.candidate.artifact.id,
        rank: entry.rank,
        dropReason: entry.dropReason,
      })),
      [
        { id: "private", rank: 0, dropReason: "shareability" },
        { id: "low", rank: 1, dropReason: "confidence" },
        { id: "empty", rank: 2, dropReason: "empty_claim" },
        { id: "public", rank: 3, dropReason: undefined },
      ]
    );
  });

  it("returns an empty window when the pool size is zero", () => {
    assert.deepEqual(buildCandidateWindow([hit(1, "public")], 0), {
      eligible: [],
      entries: [],
    });
  });
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

describe("evaluateHybridHits", () => {
  it("drops weak semantic-only candidates", () => {
    const candidate = hit(-1, "opposite semantic result");
    const decisions = evaluateHybridHits(
      [
        {
          artifact: candidate.artifact,
          rrfScore: 1 / 61,
          semanticRank: 1,
          situationScore: -1,
        },
      ],
      { minSemanticScore: 0.3, k: 5 }
    );

    assert.equal(decisions[0]?.selected, false);
    assert.equal(decisions[0]?.dropReason, "min_score");
  });

  it("admits lexical matches even when their semantic score is below the floor", () => {
    const candidate = hit(-0.5, "exact lexical recovery");
    const decisions = evaluateHybridHits(
      [
        {
          artifact: candidate.artifact,
          rrfScore: 2 / 61,
          semanticRank: 1,
          lexicalRank: 1,
          situationScore: -0.5,
          bm25Score: -4,
        },
      ],
      { minSemanticScore: 0.3, k: 5 }
    );

    assert.equal(decisions[0]?.selected, true);
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
