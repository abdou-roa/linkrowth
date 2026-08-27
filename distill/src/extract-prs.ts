import { writeFileSync } from "node:fs";
import { loadGithubReposConfig } from "./config/load";
import { extractMergedPrsForRepo } from "./github/extract";
import { dataPath } from "./paths";
import type { RawGithubPr } from "./types";

async function main(): Promise<void> {
  const cfg = loadGithubReposConfig();
  const all: RawGithubPr[] = [];

  for (const repo of cfg.repos) {
    console.log(`Extracting GitHub merged PRs: ${repo}`);
    const prs = await extractMergedPrsForRepo(repo);
    console.log(`  → ${prs.length} merged PR(s)`);
    all.push(...prs);
  }

  const out = dataPath("raw-prs.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        extractedAt: new Date().toISOString(),
        count: all.length,
        pullRequests: all,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`Wrote ${all.length} PRs → ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
