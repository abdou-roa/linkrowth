import type { RawExperienceCandidate } from "../types";
import type { LlmPrompt } from "../llm/types";
import { truncate } from "../util/text";

const MAX_BODY = 4000;
const MAX_DISCUSSION_ITEMS = 20;
const MAX_DISCUSSION_BODY = 500;
const MAX_PATHS = 40;

export function buildDistillPrompt(candidate: RawExperienceCandidate): LlmPrompt {
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

  return {
    system: `You distill one engineering-history candidate into a single Experience Artifact for later retrieval in LinkedIn comment drafts.

Return ONE JSON object. No markdown, no extra keys.

If the candidate is not a real, claimable engineering experience (chore leftover, too vague after reading paths, secrets-only, or client work you cannot anonymize), return:
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
- Never copy secrets, tokens, emails, URLs with credentials, or internal hostnames.
- Anonymize client / employer / product names unless the repo is clearly the author's public work.
- Paths are first-class evidence (especially when title/body are short). Infer stack and domains from them.
- There are no patch hunks. Do not guess line-level diffs.
- claimableLine must be something the author actually did, in first person or "we", without fake numbers.
- shareability=private if the work cannot be discussed even when anonymized (NDA, credentials, production data).
- domains: 1-8 kebab-case tags useful for retrieving this against a LinkedIn post.
- stack: 1-8 concrete technologies.
- Prefer drop over a generic artifact.`,
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
${discussion || "(none)"}`,
  };
}
