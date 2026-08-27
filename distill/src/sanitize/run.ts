import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { adaptGithubPr } from "../adapt/github";
import { adaptLocalCommit } from "../adapt/local-git";
import { dataPath } from "../paths";
import type { RawGithubPr, RawLocalGitCommit } from "../types";
import { sanitizeCandidates } from "./prune";

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function main(): void {
  const localFile = loadJson<{ commits: RawLocalGitCommit[] }>(
    dataPath("raw-local-git-logs.json")
  );
  const githubFile = loadJson<{ pullRequests: RawGithubPr[] }>(
    dataPath("raw-prs.json")
  );

  if (!localFile && !githubFile) {
    throw new Error(
      "Nothing to sanitize. Run extract:local and/or extract:github first (expected data/raw-local-git-logs.json and/or data/raw-prs.json)."
    );
  }

  const candidates = [
    ...(localFile?.commits ?? []).map(adaptLocalCommit),
    ...(githubFile?.pullRequests ?? []).map(adaptGithubPr),
  ];

  const { kept, dropped } = sanitizeCandidates(candidates);

  const keptPath = dataPath("candidates.sanitized.json");
  const droppedPath = dataPath("candidates.dropped.json");

  writeFileSync(
    keptPath,
    JSON.stringify(
      {
        sanitizedAt: new Date().toISOString(),
        count: kept.length,
        candidates: kept,
      },
      null,
      2
    ),
    "utf-8"
  );
  writeFileSync(
    droppedPath,
    JSON.stringify(
      {
        sanitizedAt: new Date().toISOString(),
        count: dropped.length,
        dropped,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(
    `Sanitized ${candidates.length} → kept ${kept.length}, dropped ${dropped.length}`
  );
  console.log(`  kept    → ${keptPath}`);
  console.log(`  dropped → ${droppedPath}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
