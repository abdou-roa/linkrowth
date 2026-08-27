import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalRepoEntry, LocalRepoMode } from "../config/load";
import type { RawLocalGitCommit } from "../types";

const execFileAsync = promisify(execFile);

/**
 * Run git in another checkout. History is read from that repo's `.git` on disk —
 * no GitHub HTML/API required.
 */
export async function gitInRepo(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf-8",
  });
  return stdout;
}

export function assertGitCheckout(repoPath: string): string {
  const abs = resolve(repoPath);
  if (!existsSync(abs)) {
    throw new Error(`Local repo path does not exist: ${abs}`);
  }
  if (!existsSync(resolve(abs, ".git"))) {
    throw new Error(
      `Not a git checkout (missing .git): ${abs}. Clone the project once, then point config at that path.`
    );
  }
  return abs;
}

function buildLogArgs(author: string, mode: LocalRepoMode, range?: string): string[] {
  const args = [
    "log",
    `--author=${author}`,
    "--no-decorate",
    // US (0x1f) between fields, RS (0x1e) between commits — see local-git-ingestion-spec §3
    "--pretty=format:%H%x1f%aI%x1f%s%x1f%b%x1e",
    "--name-only",
  ];
  if (mode === "merges") {
    args.splice(1, 0, "--merges");
  } else if (range?.trim()) {
    args.push(range.trim());
  }
  return args;
}

/**
 * Parse delimiter protocol + `--name-only` blocks.
 *
 * Per commit, git prints: `sha US date US subject US body RS` then path lines.
 */
export function parseLocalGitLog(output: string, repoPath: string): RawLocalGitCommit[] {
  const repoSlug = basename(repoPath);
  const commits: RawLocalGitCommit[] = [];

  const recordRe =
    /([0-9a-f]{40})\x1f([^\x1f]*)\x1f([^\x1f]*)\x1f([\s\S]*?)\x1e\n?([\s\S]*?)(?=[0-9a-f]{40}\x1f|$)/g;

  let match: RegExpExecArray | null;
  while ((match = recordRe.exec(output)) !== null) {
    const [, sha, authorDate, subject, body, pathBlock] = match;
    const paths = (pathBlock ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes("\x1f"));

    commits.push({
      sha: sha!,
      authorDate: (authorDate ?? "").trim(),
      subject: (subject ?? "").trim(),
      body: (body ?? "").replace(/^\n/, "").replace(/\n$/, "").trim(),
      paths,
      repoPath,
      repoSlug,
    });
  }

  return commits;
}

export async function extractRepoCommits(
  entry: LocalRepoEntry,
  author: string
): Promise<RawLocalGitCommit[]> {
  const abs = assertGitCheckout(entry.path);
  const mode: LocalRepoMode = entry.mode ?? "merges";
  const args = buildLogArgs(author, mode, entry.range);
  const output = await gitInRepo(abs, args);
  return parseLocalGitLog(output, abs);
}
