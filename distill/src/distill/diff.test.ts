import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getDistillRoot } from "../paths";
import {
  architecturalPaths,
  boundPatch,
  loadCodeDiff,
  MAX_DIFF_FILES,
  needsCodeDiff,
  SHORT_BODY_CHARS,
} from "./diff";
import type { RawExperienceCandidate } from "../types";

function candidate(body: string): RawExperienceCandidate {
  return {
    id: "exp_local_x",
    source: "local_git",
    repo: "linkrowth",
    implementationDate: "2026-08-26T00:00:00Z",
    title: "Feat: SL gating v1",
    body,
    paths: ["agent/src/core/engage.ts"],
    meta: {},
  };
}

describe("needsCodeDiff", () => {
  it("loads a diff when the commit body is under 80 characters", () => {
    assert.equal(needsCodeDiff(candidate("")), true);
    assert.equal(needsCodeDiff(candidate("n".repeat(SHORT_BODY_CHARS - 1))), true);
    assert.equal(needsCodeDiff(candidate("n".repeat(SHORT_BODY_CHARS))), false);
  });
});

describe("architecturalPaths", () => {
  it("drops lockfiles and assets, keeps source", () => {
    assert.deepEqual(
      architecturalPaths([
        "package-lock.json",
        "icon.png",
        "distill/src/distill/one.ts",
      ]),
      ["distill/src/distill/one.ts"]
    );
  });
});

describe("boundPatch", () => {
  it("returns null for empty input", () => {
    assert.equal(boundPatch(""), null);
    assert.equal(boundPatch("   "), null);
  });

  it("skips binary files and caps the number of text files", () => {
    const files = Array.from({ length: MAX_DIFF_FILES + 2 }, (_, i) => {
      if (i === 0) {
        return `diff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ`;
      }
      return `diff --git a/f${i}.ts b/f${i}.ts\n+line ${i}`;
    }).join("\n");

    const bounded = boundPatch(files);
    assert.ok(bounded);
    assert.doesNotMatch(bounded, /icon\.png/);
    assert.match(bounded, /f1\.ts/);
    assert.match(bounded, /more files omitted/);
  });

  it("truncates long hunks", () => {
    const lines = ["diff --git a/a.ts b/a.ts", ...Array.from({ length: 200 }, (_, i) => `+${i}`)];
    const bounded = boundPatch(lines.join("\n"));
    assert.ok(bounded);
    assert.match(bounded, /hunk truncated/);
    assert.ok((bounded.match(/\n/g) ?? []).length < 200);
  });
});

describe("loadCodeDiff", () => {
  it("reads a bounded patch from a real local checkout for a short-body commit", async () => {
    const repoPath = join(getDistillRoot(), "..");
    const sha = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
      encoding: "utf-8",
    }).trim();
    const names = execFileSync(
      "git",
      ["-C", repoPath, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", sha],
      { encoding: "utf-8" }
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (names.length === 0) return;

    const patch = await loadCodeDiff({
      id: "exp_local_linkrowth_head",
      source: "local_git",
      repo: "linkrowth",
      implementationDate: "2026-08-26T00:00:00Z",
      title: "head",
      body: "",
      paths: names,
      meta: { sha, repoPath },
    });

    assert.ok(patch);
    assert.match(patch, /diff --git /);
  });
});
