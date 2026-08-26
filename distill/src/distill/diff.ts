import { existsSync } from "node:fs";
import { gitInRepo } from "../local-git/runLog";
import { isNonArchitecturalPath } from "../sanitize/paths";
import type { RawExperienceCandidate } from "../types";

/** Historic subject-only commits: fetch a bounded diff so the LLM can see the change. */
export const SHORT_BODY_CHARS = 80;
export const MAX_DIFF_FILES = 10;
export const MAX_DIFF_LINES_PER_FILE = 80;
export const MAX_DIFF_CHARS = 8000;
export const MAX_DIFF_PATHS = 15;

export function needsCodeDiff(candidate: RawExperienceCandidate): boolean {
  return candidate.body.trim().length < SHORT_BODY_CHARS;
}

export function architecturalPaths(paths: string[]): string[] {
  return paths.filter((p) => !isNonArchitecturalPath(p)).slice(0, MAX_DIFF_PATHS);
}

/** Truncate a unified diff: skip binaries, cap files/lines/chars. */
export function boundPatch(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const chunks = trimmed.split(/(?=^diff --git )/m).filter((c) => c.trim());
  const files = (chunks.length > 0 ? chunks : [trimmed]).filter(
    (chunk) =>
      !/\bbinary files?\b/i.test(chunk) &&
      !/\bGIT binary patch\b/i.test(chunk) &&
      !chunk.includes("\0")
  );

  const clipped = files.slice(0, MAX_DIFF_FILES).map((chunk) => {
    const lines = chunk.split("\n").slice(0, MAX_DIFF_LINES_PER_FILE);
    if (chunk.split("\n").length > MAX_DIFF_LINES_PER_FILE) {
      lines.push("… (hunk truncated)");
    }
    return lines.join("\n");
  });

  let text = clipped.join("\n");
  if (files.length > MAX_DIFF_FILES) {
    text += `\n… ${files.length - MAX_DIFF_FILES} more files omitted`;
  }
  if (text.length > MAX_DIFF_CHARS) {
    text = `${text.slice(0, MAX_DIFF_CHARS).trimEnd()}\n… (diff truncated)`;
  }
  return text.trim() ? text : null;
}

async function loadLocalGitDiff(candidate: RawExperienceCandidate): Promise<string | null> {
  const repoPath = String(candidate.meta.repoPath ?? "").trim();
  const sha = String(candidate.meta.sha ?? "").trim();
  if (!repoPath || !sha || !existsSync(repoPath)) return null;

  const paths = architecturalPaths(candidate.paths);
  if (candidate.paths.length > 0 && paths.length === 0) return null;

  const args = [
    "diff-tree",
    "-p",
    "-m",
    "--first-parent",
    "--root",
    "--no-commit-id",
    "--no-color",
    "-U2",
    sha,
  ];
  if (paths.length > 0) args.push("--", ...paths);

  const raw = await gitInRepo(repoPath, args);
  return boundPatch(raw);
}

async function loadGithubPrDiff(candidate: RawExperienceCandidate): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const number = Number(candidate.meta.number);
  const [owner, name] = candidate.repo.split("/");
  if (!token || !Number.isFinite(number) || !owner || !name) return null;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/pulls/${number}/files?per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "linkrowth-distill",
      },
    }
  );
  if (!res.ok) return null;

  const files = (await res.json()) as Array<{ filename?: string; patch?: string }>;
  if (!Array.isArray(files)) return null;

  const parts: string[] = [];
  for (const file of files) {
    const filename = file.filename ?? "";
    if (!filename || isNonArchitecturalPath(filename) || !file.patch) continue;
    parts.push(`diff --git a/${filename} b/${filename}\n${file.patch}`);
  }
  return boundPatch(parts.join("\n"));
}

/** Bounded patch for short-body candidates. Returns null when unavailable. Never throws. */
export async function loadCodeDiff(candidate: RawExperienceCandidate): Promise<string | null> {
  if (!needsCodeDiff(candidate)) return null;
  try {
    if (candidate.source === "local_git") return await loadLocalGitDiff(candidate);
    if (candidate.source === "github_pr") return await loadGithubPrDiff(candidate);
    return null;
  } catch {
    return null;
  }
}
