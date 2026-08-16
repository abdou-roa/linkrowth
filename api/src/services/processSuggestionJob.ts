import {
  MULTI_STEP_ENGAGE_AGENT_ID,
  runEngageWithStatus,
} from "@linkrowth/agent/runs";
import type { Post } from "@linkrowth/agent/types";
import type { FeedPostInput } from "../types/suggestions";

function toAgentPost(feedPost: FeedPostInput): Post {
  return {
    id: feedPost.id,
    url: feedPost.url,
    text: feedPost.text,
    author: feedPost.author,
    metrics: feedPost.metrics,
    comments: feedPost.comments,
    ageText: feedPost.ageText,
    extractedAt: feedPost.extractedAt,
  };
}

/**
 * Run engage in-process for a queued suggestion job.
 * Fire-and-forget from the HTTP handler; updates job status via the agent repository.
 * Always uses the multi-step pipeline (analyzer → HITL gate → drafter → …).
 * A pause for clarification is a successful intermediate outcome, not a failure.
 */
export async function processSuggestionJob(
  jobId: string,
  feedPost: FeedPostInput
): Promise<void> {
  const outcome = await runEngageWithStatus(toAgentPost(feedPost), {
    jobId,
    agentId: MULTI_STEP_ENGAGE_AGENT_ID,
  });

  if (outcome.kind === "awaiting_clarification") {
    console.log(
      "[api] suggestion job awaiting clarification",
      jobId,
      outcome.clarification.question
    );
  }
}
