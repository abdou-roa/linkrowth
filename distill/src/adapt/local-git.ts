import type { RawExperienceCandidate, RawLocalGitCommit } from "../types";

export function adaptLocalCommit(c: RawLocalGitCommit): RawExperienceCandidate {
  const slug = c.repoSlug.replace(/[^a-zA-Z0-9]+/g, "_");
  const short = c.sha.slice(0, 12);
  return {
    id: `exp_local_${slug}_${short}`,
    source: "local_git",
    repo: c.repoSlug,
    implementationDate: c.authorDate,
    title: c.subject,
    body: c.body,
    paths: c.paths,
    meta: {
      sha: c.sha,
      repoPath: c.repoPath,
    },
  };
}
