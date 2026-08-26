import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmRequest } from "../llm/types";
import type { RawExperienceCandidate } from "../types";
import { distillCandidates } from "./engine";

const candidate = (id: string, title: string): RawExperienceCandidate => ({
  id,
  source: "github_pr",
  repo: "abdou-roa/linkrowth",
  implementationDate: "2026-08-02T13:11:00Z",
  title,
  body: "Analyzer, drafter, refiner.",
  paths: ["agent/src/steps/analyzer.ts", "agent/src/agents/multiStepEngage.ts"],
  meta: {},
});

describe("distillCandidates", () => {
  it("keeps parsed artifacts, records drops, and skips existing ids unless forced", async () => {
    const calls: string[] = [];
    const call = async (request: LlmRequest): Promise<string> => {
      calls.push(request.user);
      if (request.user.includes("exp_gh_skip")) {
        throw new Error("should not be called for existing id");
      }
      if (request.user.includes("exp_gh_drop")) {
        return JSON.stringify({ drop: true, reason: "too vague" });
      }
      return JSON.stringify({
        title: "Multi-step engage",
        domains: ["multi-step-agents"],
        stack: ["TypeScript"],
        problem: "One-shot drafts were mediocre.",
        approach: "Split engage into analyze, draft, and refine.",
        tradeoff: "More latency for inspectable steps.",
        claimableLine: "I split comment drafting into analyze, draft, and refine so failures are inspectable.",
        confidence: "high",
        shareability: "public",
      });
    };

    const existing = [
      {
        id: "exp_gh_skip",
        sourceCandidateId: "exp_gh_skip",
        source: "github_pr" as const,
        repo: "abdou-roa/linkrowth",
        implementationDate: "2026-07-01T00:00:00Z",
        title: "Already distilled",
        domains: ["x"],
        stack: ["ts"],
        problem: "p",
        approach: "a",
        tradeoff: "",
        claimableLine: "already",
        confidence: "high" as const,
        shareability: "public" as const,
        paths: [],
      },
    ];

    const { artifacts, dropped } = await distillCandidates(
      [
        candidate("exp_gh_skip", "Old"),
        candidate("exp_gh_keep", "Add multi-step engage"),
        candidate("exp_gh_drop", "WIP"),
      ],
      { call, existingArtifacts: existing, concurrency: 2, loadDiff: async () => null }
    );

    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0]?.id, "exp_gh_skip");
    assert.equal(artifacts[1]?.id, "exp_gh_keep");
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.rule, "D_drop");
    assert.equal(calls.length, 2);
  });

  it("retries once when the first response is not JSON, then keeps the artifact", async () => {
    let n = 0;
    const call = async (): Promise<string> => {
      n += 1;
      if (n === 1) return "not json";
      return JSON.stringify({
        title: "Gemini client",
        domains: ["llm-providers"],
        stack: ["Gemini"],
        problem: "Needed a second provider with the same call() contract.",
        approach: "Added a Gemini client next to OpenAI.",
        tradeoff: "",
        claimableLine: "I route engage through a provider-agnostic call() with OpenAI and Gemini clients.",
        confidence: "high",
        shareability: "public",
      });
    };

    const { artifacts, dropped } = await distillCandidates(
      [candidate("exp_gh_retry", "Add Gemini client")],
      { call, loadDiff: async () => null }
    );

    assert.equal(n, 2);
    assert.equal(dropped.length, 0);
    assert.equal(artifacts[0]?.id, "exp_gh_retry");
  });
});
