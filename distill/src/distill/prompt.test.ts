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
      body: "Analyzer → drafter → refiner",
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
    assert.match(prompt.user, /github_pr/);
    assert.match(prompt.user, /agent\/src\/steps\/analyzer.ts/);
    assert.match(prompt.user, /Keep the engage\(\) signature stable/);
    assert.doesNotMatch(prompt.user, /diff --git/);
  });
});
