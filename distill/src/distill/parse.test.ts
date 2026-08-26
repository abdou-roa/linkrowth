import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDistillResponse } from "./parse";
import type { RawExperienceCandidate } from "../types";

const candidate: RawExperienceCandidate = {
  id: "exp_local_linkrowth_abc123",
  source: "local_git",
  repo: "linkrowth",
  implementationDate: "2026-08-25T18:09:22Z",
  title: "Add path-aware sanitize for extracted experience candidates",
  body: "Deterministic pre-LLM prune. No network.",
  paths: ["distill/src/sanitize/prune.ts", "distill/src/sanitize/paths.ts"],
  meta: {},
};

describe("parseDistillResponse", () => {
  it("parses a fenced JSON artifact and copies identity fields from the candidate", () => {
    const raw = `Here you go:\n\`\`\`json
{
  "title": "Path-aware sanitize before distill",
  "domains": ["experience-distillation", "git-history"],
  "stack": ["TypeScript"],
  "problem": "Noisy git history would waste distill tokens on lockfile bumps.",
  "approach": "Deterministic path-aware prune of merge syncs, bots, and asset-only diffs.",
  "tradeoff": "Subject-only commits are kept when paths show real code.",
  "claimableLine": "I prune engineering history with path-aware rules before any LLM distill call.",
  "confidence": "high",
  "shareability": "public"
}
\`\`\``;

    const outcome = parseDistillResponse(raw, candidate);
    assert.equal(outcome.kind, "artifact");
    if (outcome.kind !== "artifact") return;

    assert.equal(outcome.artifact.id, candidate.id);
    assert.equal(outcome.artifact.sourceCandidateId, candidate.id);
    assert.equal(outcome.artifact.source, "local_git");
    assert.equal(outcome.artifact.repo, "linkrowth");
    assert.equal(outcome.artifact.shareability, "public");
    assert.equal(outcome.artifact.confidence, "high");
    assert.deepEqual(outcome.artifact.paths, candidate.paths);
    assert.match(outcome.artifact.claimableLine, /path-aware/);
  });

  it("drops when the model sets drop:true", () => {
    const outcome = parseDistillResponse(
      `{"drop":true,"reason":"lockfile-only leftover"}`,
      candidate
    );
    assert.equal(outcome.kind, "drop");
    if (outcome.kind !== "drop") return;
    assert.equal(outcome.drop.rule, "D_drop");
    assert.equal(outcome.drop.detail, "lockfile-only leftover");
  });

  it("drops private shareability so client work never reaches the index", () => {
    const outcome = parseDistillResponse(
      JSON.stringify({
        title: "Client ETL",
        domains: ["etl"],
        stack: ["Python"],
        problem: "A bank needed overnight files moved.",
        approach: "Wrote an SFTP worker.",
        tradeoff: "",
        claimableLine: "I built an SFTP worker for a bank.",
        confidence: "high",
        shareability: "private",
      }),
      candidate
    );
    assert.equal(outcome.kind, "drop");
    if (outcome.kind !== "drop") return;
    assert.equal(outcome.drop.rule, "D_private");
  });

  it("drops empty claimableLine", () => {
    const outcome = parseDistillResponse(
      JSON.stringify({
        title: "Misc",
        domains: ["x"],
        stack: ["ts"],
        problem: "Something changed.",
        approach: "Touched files.",
        tradeoff: "",
        claimableLine: "  ",
        confidence: "low",
        shareability: "public",
      }),
      candidate
    );
    assert.equal(outcome.kind, "drop");
    if (outcome.kind !== "drop") return;
    assert.equal(outcome.drop.rule, "D_unclaimable");
  });

  it("defaults unknown shareability to anonymized", () => {
    const outcome = parseDistillResponse(
      JSON.stringify({
        title: "Queue worker",
        domains: ["jobs"],
        stack: ["Postgres"],
        problem: "Suggestion jobs needed durable state.",
        approach: "Persisted jobs in Postgres with a status machine.",
        tradeoff: "In-process worker instead of a broker.",
        claimableLine: "I persist suggestion jobs in Postgres instead of an in-memory queue.",
        confidence: "nope",
        shareability: "everyone",
      }),
      candidate
    );
    assert.equal(outcome.kind, "artifact");
    if (outcome.kind !== "artifact") return;
    assert.equal(outcome.artifact.shareability, "anonymized");
    assert.equal(outcome.artifact.confidence, "medium");
  });
});
