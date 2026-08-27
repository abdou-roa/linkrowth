import type { RawExperienceCandidate } from "../types";
import type { LlmPrompt } from "../llm/types";
import { truncate } from "../util/text";
import { needsCodeDiff } from "./diff";

const MAX_BODY = 4000;
const MAX_DISCUSSION_ITEMS = 20;
const MAX_DISCUSSION_BODY = 500;
const MAX_PATHS = 40;

export interface DistillPromptOptions {
  /** Bounded unified diff, when the commit/PR body is too short to distill from. */
  diff?: string | null;
}

export function buildDistillPrompt(
  candidate: RawExperienceCandidate,
  options: DistillPromptOptions = {}
): LlmPrompt {
  const discussion = (candidate.discussion ?? [])
    .slice(0, MAX_DISCUSSION_ITEMS)
    .map((d) => {
      const path = d.path ? ` [${d.path}]` : "";
      return `- ${d.kind} @${d.author}${path}: ${truncate(d.body, MAX_DISCUSSION_BODY)}`;
    })
    .join("\n");

  const paths = candidate.paths.slice(0, MAX_PATHS).join("\n");
  const omittedPaths =
    candidate.paths.length > MAX_PATHS
      ? `\n… ${candidate.paths.length - MAX_PATHS} more paths omitted`
      : "";

  const shortBody = needsCodeDiff(candidate);
  const diffSection = shortBody
    ? `\n\nCode changes (primary evidence — the message is short or empty):\n${
        options.diff?.trim() ||
        "(diff not available; infer a concrete change from paths + title. Do not drop only because the body is empty.)"
      }`
    : "";

  return {
    system: `You distill one engineering-history candidate into a single Experience Artifact for later retrieval in LinkedIn comment drafts.

Return ONE JSON object. No markdown, no extra keys.

Empty or one-line commit messages are the common case. Do NOT drop because the body is empty, short, or there is no discussion.

When a "Code changes" section is present, that diff is the primary evidence of what was implemented. Read it. Infer problem, approach, and tradeoff from the diff and paths.

Drop only when the change itself is not a claimable engineering experience:
- lockfile / formatting / rename-only leftover even after reading the diff
- secrets-only
- client work you cannot anonymize (use shareability=private)

Do not drop as "too vague" or "empty body" when a diff or code paths are present.

If you must drop:
{"drop":true,"reason":"<short reason>"}

Otherwise return:
{
  "title": "<short specific title>",
  "domains": ["<kebab-case retrieval tags>"],
  "stack": ["<technologies>"],
  "problem": "<1-2 sentences, anonymized>",
  "approach": "<what was actually built or changed>",
  "tradeoff": "<the interesting tension, or empty string>",
  "claimableLine": "<one sentence the author could say in a comment>",
  "confidence": "high" | "medium" | "low",
  "shareability": "public" | "anonymized" | "private"
}

HARD RULES:
- Use only the evidence in the user message. Never invent metrics, customers, or outcomes.
- Never copy secrets, tokens, emails, URLs with credentials, or internal hostnames from the diff.
- Anonymize client / employer / product names unless the repo is clearly the author's public work.
- Paths and diffs are first-class evidence. Do not guess line-level changes that are not in the diff.
- claimableLine must be something the author actually did, in first person or "we", without fake numbers.
- shareability=private if the work cannot be discussed even when anonymized (NDA, credentials, production data).
- domains: 1-8 kebab-case tags useful for retrieving this against a LinkedIn post.
- stack: 1-8 concrete technologies.`,
    user: `Source: ${candidate.source}
Repo: ${candidate.repo}
Date: ${candidate.implementationDate}
Id: ${candidate.id}

Title:
${candidate.title || "(empty)"}

Body:
${truncate(candidate.body, MAX_BODY) || "(empty)"}

Changed paths:
${paths || "(none)"}${omittedPaths}

Discussion:
${discussion || "(none)"}${diffSection}`,
  };
}
