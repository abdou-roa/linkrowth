import type { DiscussionItem, RawGithubPr } from "../types";
import { githubGraphql } from "./client";
import { MERGED_PRS_QUERY } from "./queries";

interface AuthorNode {
  __typename?: string;
  login: string;
}

interface PrNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  mergedAt: string | null;
  createdAt: string;
  author: AuthorNode | null;
  files: { nodes: Array<{ path: string; additions: number; deletions: number }> | null } | null;
  comments: { nodes: Array<{ author: { login: string } | null; body: string }> | null } | null;
  reviews: {
    nodes: Array<{
      author: { login: string } | null;
      state: string;
      body: string | null;
      comments: {
        nodes: Array<{
          author: { login: string } | null;
          body: string;
          path: string | null;
        }> | null;
      } | null;
    }> | null;
  } | null;
}

interface MergedPrsData {
  repository: {
    nameWithOwner: string;
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<PrNode | null> | null;
    };
  } | null;
}

function mapDiscussion(pr: PrNode): DiscussionItem[] {
  const items: DiscussionItem[] = [];

  for (const c of pr.comments?.nodes ?? []) {
    if (!c) continue;
    items.push({
      kind: "issue_comment",
      author: c.author?.login ?? "unknown",
      body: c.body ?? "",
    });
  }

  for (const review of pr.reviews?.nodes ?? []) {
    if (!review) continue;
    if (review.body?.trim()) {
      items.push({
        kind: "review",
        author: review.author?.login ?? "unknown",
        body: review.body,
      });
    }
    for (const rc of review.comments?.nodes ?? []) {
      if (!rc) continue;
      items.push({
        kind: "review_comment",
        author: rc.author?.login ?? "unknown",
        body: rc.body ?? "",
        path: rc.path ?? undefined,
      });
    }
  }

  return items;
}

function mapPr(pr: PrNode, repo: string): RawGithubPr | null {
  if (!pr.mergedAt) return null;
  const authorLogin = pr.author?.login ?? "unknown";
  const authorIsBot = pr.author?.__typename === "Bot";

  return {
    id: pr.id,
    number: pr.number,
    title: pr.title ?? "",
    body: pr.body ?? "",
    mergedAt: pr.mergedAt,
    createdAt: pr.createdAt,
    authorLogin,
    authorIsBot,
    repo,
    paths: (pr.files?.nodes ?? []).filter(Boolean).map((f) => ({
      path: f!.path,
      additions: f!.additions,
      deletions: f!.deletions,
    })),
    discussion: mapDiscussion(pr),
  };
}

export async function extractMergedPrsForRepo(nameWithOwner: string): Promise<RawGithubPr[]> {
  const [owner, name] = nameWithOwner.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo: ${nameWithOwner}`);
  }

  const results: RawGithubPr[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const data: MergedPrsData = await githubGraphql<MergedPrsData>(MERGED_PRS_QUERY, {
      owner,
      name,
      cursor,
    });

    const repo = data.repository;
    if (!repo) {
      throw new Error(`Repository not found or inaccessible: ${nameWithOwner}`);
    }

    for (const node of repo.pullRequests.nodes ?? []) {
      if (!node) continue;
      const mapped = mapPr(node, repo.nameWithOwner);
      if (mapped) results.push(mapped);
    }

    hasNext = repo.pullRequests.pageInfo.hasNextPage;
    cursor = repo.pullRequests.pageInfo.endCursor;
  }

  return results;
}
