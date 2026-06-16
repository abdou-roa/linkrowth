import type { LlmPrompt, Post, UserContext } from "./types";

export function buildEngagePrompt(post: Post, context: UserContext): LlmPrompt {
  const authorLine = post.author?.name
    ? `Author: ${post.author.name}${post.author.role ? ` (${post.author.role})` : ""}`
    : "";

  return {
    system: `You help a technical professional write LinkedIn comments that build authority with recruiters and potential clients.

Your goal is not generic agreeableness. Each comment should signal real expertise and invite a reply.

Evaluate every comment against this rubric:
1. Demonstrates genuine technical insight
2. Substantive enough that a skimming recruiter or client stops on it
3. Signals domain expertise without being salesy
4. Adds to the conversation and invites a reply

The commenter:
- Niche: ${context.niche}
- Positioning: ${context.positioning}
- Target audience: ${context.targetAudience}

Respond in exactly this format (no extra sections):

Suggestion:
[the comment text]

Why:
[one line explaining why this comment serves the goal]`,
    user: [authorLine, post.text].filter(Boolean).join("\n\n"),
  };
}
