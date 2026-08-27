import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDistillPrompt } from "./prompt";
import type { RawExperienceCandidate } from "../types";

describe("buildDistillPrompt", () => {
  it("includes paths, source identity, and the no-invention contract", () => {
    const candidate: RawExperienceCandidate = {
      id: "exp_gh_abdou_roa_linkrowth_15",
      source: "github_pr",
      repo: "abdou-roa/linkrowth",
      implementationDate: "2026-08-02T13:11:00Z",
      title: "Multi-step engage agent",
      body: "Analyzer, drafter, and refiner steps so comment quality is inspectable per hop rather than one opaque prompt.",
      paths: ["agent/src/steps/analyzer.ts"],
      discussion: [
        {
          kind: "review_comment",
          author: "reviewer",
          body: "Keep the engage() signature stable.",
          path: "agent/src/core/engage.ts",
        },
      ],
      meta: {},
    };

    const prompt = buildDistillPrompt(candidate);
    assert.match(prompt.system, /Never invent metrics/);
    assert.match(prompt.system, /JSON object/);
    assert.match(prompt.system, /Do NOT drop because the body is empty/);
    assert.match(prompt.user, /github_pr/);
    assert.match(prompt.user, /agent\/src\/steps\/analyzer.ts/);
    assert.match(prompt.user, /Keep the engage\(\) signature stable/);
    assert.doesNotMatch(prompt.user, /Code changes/);
  });

  it("treats a short or empty body as a cue to use the diff, not to drop", () => {
    const candidate: RawExperienceCandidate = {
      id: "exp_local_x_abc",
      source: "local_git",
      repo: "linkrowth",
      implementationDate: "2026-08-25T00:00:00Z",
      title: "Feat: SL gating v1",
      body: "",
      paths: ["agent/src/core/engage.ts"],
      meta: {},
    };

    const prompt = buildDistillPrompt(candidate, {
      diff: "diff --git a/agent/src/core/engage.ts b/agent/src/core/engage.ts\n+gate()",
    });
    assert.match(prompt.user, /Code changes \(primary evidence/);
    assert.match(prompt.user, /\+gate\(\)/);
    assert.match(prompt.system, /diff is the primary evidence/);
    assert.doesNotMatch(prompt.system, /Prefer drop over a generic artifact/);
  });
});
