import type { RawExperienceCandidate, RawGithubPr } from "../types";

export function adaptGithubPr(pr: RawGithubPr): RawExperienceCandidate {
  const slug = pr.repo.replace(/[^a-zA-Z0-9]+/g, "_");
  return {
    id: `exp_gh_${slug}_${pr.number}`,
    source: "github_pr",
    repo: pr.repo,
    implementationDate: pr.mergedAt,
    title: pr.title,
    body: pr.body,
    paths: pr.paths.map((p) => p.path),
    discussion: pr.discussion,
    meta: {
      githubNodeId: pr.id,
      number: pr.number,
      authorLogin: pr.authorLogin,
      authorIsBot: pr.authorIsBot,
      createdAt: pr.createdAt,
    },
  };
}
