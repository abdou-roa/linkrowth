import { writeFileSync } from "node:fs";
import { loadLocalReposConfig } from "./config/load";
import { extractRepoCommits } from "./local-git/runLog";
import { dataPath } from "./paths";
import type { RawLocalGitCommit } from "./types";

async function main(): Promise<void> {
  const cfg = loadLocalReposConfig();
  const all: RawLocalGitCommit[] = [];

  for (const entry of cfg.repos) {
    console.log(`Extracting local git: ${entry.path} (mode=${entry.mode ?? "merges"})`);
    const commits = await extractRepoCommits(entry, cfg.author);
    console.log(`  → ${commits.length} commit(s)`);
    all.push(...commits);
  }

  const out = dataPath("raw-local-git-logs.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        extractedAt: new Date().toISOString(),
        author: cfg.author,
        count: all.length,
        commits: all,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`Wrote ${all.length} commits → ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
