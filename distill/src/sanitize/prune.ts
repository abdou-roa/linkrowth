import type { DropRecord, RawExperienceCandidate } from "../types";
import { isNonArchitecturalOnly } from "./paths";

const BOT_LOGINS = new Set([
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "github-actions",
  "github-actions[bot]",
  "greenkeeper",
  "greenkeeper[bot]",
]);

const MERGE_BRANCH_RE = /^Merge branch ['"][^'"]+['"]/i;
const DEPS_BUMP_RE =
  /^(chore\()?deps?(\)|:)?\b|bump .+ from |bump version to |update dependency /i;

/**
 * Whole-subject noise only. Short titles like "Feat: SL gating v1" must pass.
 * Do not use message length — subject-only commits are the common case.
 */
const TRIVIAL_TITLE_RE =
  /^(wip|tmp|temp|asdf|test|testing|typo|fix typo|formatting|format|lint|prettier|eslint|black|style|misc|nits?|address nits?|oops|ok|done|update|updates|changes|minor|cleanup|clean up|chore)([.!,:;…]|\s)*$/i;

const MIN_DISCUSSION_BODY = 20;

export interface SanitizeResult {
  kept: RawExperienceCandidate[];
  dropped: DropRecord[];
}

function drop(
  c: RawExperienceCandidate,
  rule: string,
  dropped: DropRecord[]
): void {
  dropped.push({
    id: c.id,
    rule,
    title: c.title,
    source: c.source,
    repo: c.repo,
  });
}

function pruneDiscussion(c: RawExperienceCandidate): RawExperienceCandidate {
  if (!c.discussion?.length) return c;
  return {
    ...c,
    discussion: c.discussion.filter(
      (d) => d.body.trim().length >= MIN_DISCUSSION_BODY
    ),
  };
}

function hasCodePaths(paths: string[]): boolean {
  return paths.length > 0 && !isNonArchitecturalOnly(paths);
}

function isTrivialTitle(title: string): boolean {
  return TRIVIAL_TITLE_RE.test(title.trim());
}

/**
 * Deterministic pre-LLM prune (shared rules S1–S5 + source-specific).
 * No network, no LLM.
 *
 * Message length is not a drop criterion. Prefer path signal + trivial denylist.
 */
export function sanitizeCandidates(
  candidates: RawExperienceCandidate[]
): SanitizeResult {
  const kept: RawExperienceCandidate[] = [];
  const dropped: DropRecord[] = [];

  for (const raw of candidates) {
    const c = pruneDiscussion(raw);
    const title = c.title.trim();
    const body = c.body.trim();
    const codePaths = hasCodePaths(c.paths);

    // S1 — automated branch sync
    if (MERGE_BRANCH_RE.test(title)) {
      drop(c, "S1_merge_branch_sync", dropped);
      continue;
    }

    // S2 — dependency bots / bump titles
    const authorLogin = String(c.meta.authorLogin ?? "").toLowerCase();
    const authorIsBot = c.meta.authorIsBot === true;
    if (authorIsBot || BOT_LOGINS.has(authorLogin) || DEPS_BUMP_RE.test(c.title)) {
      drop(c, "S2_dependency_or_bot", dropped);
      continue;
    }

    // S3 — trivial whole-subject denylist (not length)
    if (isTrivialTitle(title)) {
      drop(c, "S3_trivial_title", dropped);
      continue;
    }

    // S4 — no distillable surface: no code paths and no usable text
    if (!codePaths && !title && !body) {
      drop(c, "S4_no_distillable_surface", dropped);
      continue;
    }

    // S5 — lockfile / asset-only (paths present and all non-architectural)
    if (isNonArchitecturalOnly(c.paths)) {
      drop(c, "S5_non_architectural_paths", dropped);
      continue;
    }

    // GitHub: empty body + empty discussion after prune
    if (
      c.source === "github_pr" &&
      !body &&
      (!c.discussion || c.discussion.length === 0)
    ) {
      drop(c, "S_github_empty_body_and_discussion", dropped);
      continue;
    }

    kept.push(c);
  }

  return { kept, dropped };
}
