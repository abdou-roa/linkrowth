/** Source-agnostic candidate after Extract adapters, before / after sanitize. */
export type ExperienceSource = "github_pr" | "local_git" | "cursor_chat";

export interface DiscussionItem {
  kind: "review" | "review_comment" | "issue_comment";
  author: string;
  body: string;
  path?: string;
}

export interface RawExperienceCandidate {
  /** Deterministic across re-runs */
  id: string;
  source: ExperienceSource;
  /** "owner/name" or local repo basename */
  repo: string;
  /** ISO-8601 production anchor */
  implementationDate: string;
  title: string;
  body: string;
  /** Changed paths only — never patch hunks */
  paths: string[];
  discussion?: DiscussionItem[];
  meta: Record<string, string | number | boolean | null>;
}

/** Raw local-git extract row (before adapt / sanitize). */
export interface RawLocalGitCommit {
  sha: string;
  authorDate: string;
  subject: string;
  body: string;
  paths: string[];
  repoPath: string;
  repoSlug: string;
}

/** Raw GitHub PR extract row (before adapt / sanitize). */
export interface RawGithubPr {
  id: string;
  number: number;
  title: string;
  body: string;
  mergedAt: string;
  createdAt: string;
  authorLogin: string;
  authorIsBot: boolean;
  repo: string;
  paths: Array<{ path: string; additions: number; deletions: number }>;
  discussion: DiscussionItem[];
}

export interface DropRecord {
  id: string;
  rule: string;
  title: string;
  source: ExperienceSource;
  repo: string;
}
