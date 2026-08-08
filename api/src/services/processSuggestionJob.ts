import {
  MULTI_STEP_ENGAGE_AGENT_ID,
  runEngage,
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
 * Always uses the multi-step pipeline (analyzer → …).
 */
export async function processSuggestionJob(
  jobId: string,
  feedPost: FeedPostInput
): Promise<void> {
  await runEngage(toAgentPost(feedPost), {
    jobId,
    agentId: MULTI_STEP_ENGAGE_AGENT_ID,
  });
}
