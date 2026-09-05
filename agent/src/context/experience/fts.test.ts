import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceArtifact } from "./types";
import { buildFts5Query, fuseRRF, normalizeTechnicalTerms, tokenizeFts5Terms } from "./fts";

const artifact = (id: string, title: string): ExperienceArtifact => ({
  id,
  sourceCandidateId: id,
  source: "local_git",
  repo: "linkrowth",
  implementationDate: "2026-08-01T00:00:00Z",
  title,
  domains: ["postgres"],
  stack: ["Postgres"],
  problem: "p",
  approach: "a",
  tradeoff: "",
  claimableLine: `I did ${title}.`,
  confidence: "high",
  shareability: "public",
  paths: [],
});

describe("buildFts5Query", () => {
  it("quotes parser-safe terms and joins them with OR", () => {
    assert.equal(
      buildFts5Query('How do you run postgres "durable" jobs?'),
      '"run" OR "postgres" OR "durable" OR "jobs"'
    );
  });

  it("removes query operators and stopwords", () => {
    assert.equal(
      buildFts5Query("postgres OR kafka AND NOT redis"),
      '"postgres" OR "kafka" OR "redis"'
    );
  });

  it("handles punctuation and canonicalizes technical names", () => {
    assert.equal(
      buildFts5Query("Can redis-streams work with C++ and Node.js?"),
      '"redis-streams" OR "work" OR "cplusplus" OR "nodejs"'
    );
    assert.equal(normalizeTechnicalTerms("C# on .NET"), "csharp on dotnet");
  });

  it("deduplicates and bounds terms deterministically", () => {
    assert.deepEqual(tokenizeFts5Terms("Postgres postgres jobs retries queues", 3), [
      "Postgres",
      "jobs",
      "retries",
    ]);
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(buildFts5Query("   "), "");
  });
});

describe("fuseRRF", () => {
  const c = 60;

  it("combines candidates present in both lists", () => {
    const semantic = [
      { score: 0.9, artifact: artifact("a", "A") },
      { score: 0.7, artifact: artifact("b", "B") },
    ];
    const lexical = [
      { bm25Score: -5.0, artifact: artifact("b", "B") },
      { bm25Score: -3.0, artifact: artifact("c", "C") },
    ];

    const fused = fuseRRF(semantic, lexical, { c });
    assert.equal(fused.length, 3);

    const b = fused.find((f) => f.artifact.id === "b");
    assert.ok(b);
    assert.equal(b.semanticRank, 2);
    assert.equal(b.lexicalRank, 1);
    assert.ok(b.rrfScore > 1 / (c + 2)); // both terms contribute

    const a = fused.find((f) => f.artifact.id === "a");
    assert.ok(a);
    assert.equal(a.semanticRank, 1);
    assert.equal(a.lexicalRank, undefined);
    assert.equal(a.rrfScore, 1 / (c + 1));

    const top = fused[0]!;
    assert.equal(top.artifact.id, "b"); // present in both, highest RRF
  });

  it("returns empty array when both lists are empty", () => {
    assert.deepEqual(fuseRRF([], [], { c }), []);
  });

  it("includes lexical-only candidates", () => {
    const lexical = [{ bm25Score: -2.0, artifact: artifact("x", "X") }];
    const fused = fuseRRF([], lexical, { c });
    assert.equal(fused.length, 1);
    assert.equal(fused[0]!.artifact.id, "x");
    assert.equal(fused[0]!.lexicalRank, 1);
    assert.equal(fused[0]!.rrfScore, 1 / (c + 1));
  });
});
