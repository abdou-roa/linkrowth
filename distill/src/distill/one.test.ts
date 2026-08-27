import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmRequest } from "../llm/types";
import type { RawExperienceCandidate } from "../types";
import { distillOne } from "./one";

const shortCandidate: RawExperienceCandidate = {
  id: "exp_local_linkrowth_abc",
  source: "local_git",
  repo: "linkrowth",
  implementationDate: "2026-08-25T18:09:22Z",
  title: "Feat: SL gating v1",
  body: "",
  paths: ["agent/src/core/engage.ts"],
  meta: { sha: "abc", repoPath: "/tmp/not-used" },
};

describe("distillOne", () => {
  it("passes a bounded diff to the LLM for short-body local commits", async () => {
    let seenUser = "";
    const call = async (request: LlmRequest): Promise<string> => {
      seenUser = request.user;
      return JSON.stringify({
        title: "SL gating",
        domains: ["scoring"],
        stack: ["TypeScript"],
        problem: "Feed triage needed a threshold.",
        approach: "Added SL gating in engage scoring.",
        tradeoff: "",
        claimableLine: "I added score-based gating so weak posts never reach generate.",
        confidence: "high",
        shareability: "public",
      });
    };

    const outcome = await distillOne(shortCandidate, call, async () => {
      return "diff --git a/agent/src/core/engage.ts b/agent/src/core/engage.ts\n+export function gate() {}";
    });

    assert.equal(outcome.kind, "artifact");
    assert.match(seenUser, /Code changes/);
    assert.match(seenUser, /export function gate/);
    assert.match(seenUser, /\(empty\)/);
  });

  it("does not fetch a diff when the body is already long enough", async () => {
    let loaded = false;
    const long: RawExperienceCandidate = {
      ...shortCandidate,
      body: "This commit message is long enough to distill without opening the patch hunk. ".repeat(2),
    };
    const call = async (): Promise<string> =>
      JSON.stringify({
        title: "t",
        domains: ["x"],
        stack: ["ts"],
        problem: "p",
        approach: "a",
        tradeoff: "",
        claimableLine: "I wrote a long enough message to skip the diff fetch.",
        confidence: "high",
        shareability: "public",
      });

    await distillOne(long, call, async () => {
      loaded = true;
      return "should not load";
    });
    assert.equal(loaded, false);
  });
});
