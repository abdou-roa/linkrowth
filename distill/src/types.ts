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
  detail?: string;
}

export type ArtifactConfidence = "high" | "medium" | "low";
export type ArtifactShareability = "public" | "anonymized" | "private";

/**
 * Structured, claimable experience after the LLM distill pass.
 * This is what gets embedded — never raw commits / PR bodies.
 */
export interface ExperienceArtifact {
  id: string;
  sourceCandidateId: string;
  source: ExperienceSource;
  repo: string;
  implementationDate: string;
  title: string;
  /** Retrieval tags, e.g. "multi-step-agents", "postgres" */
  domains: string[];
  stack: string[];
  problem: string;
  approach: string;
  tradeoff: string;
  /** Sentence the commenter can actually say. Maps later to proofPoints. */
  claimableLine: string;
  confidence: ArtifactConfidence;
  shareability: ArtifactShareability;
  paths: string[];
}

export interface DistillDropRecord extends DropRecord {}

export interface EmbeddingMeta {
  provider: string;
  model: string;
  dimensions: number;
}

export interface IndexedExperience {
  id: string;
  vector: number[];
  artifact: ExperienceArtifact;
}

/** In-memory vector index; persisted to distill/data/experience-index.db (SQLite). */
export interface ExperienceIndex {
  indexedAt: string;
  embedding: EmbeddingMeta;
  count: number;
  items: IndexedExperience[];
}
