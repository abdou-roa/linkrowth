import { runEngageWithStatus } from "@linkrowth/agent/runs";
import type { Post } from "@linkrowth/agent/types";
import {
  resumeSuggestionJobWithAnswer,
  type PostInput,
  type ResumedSuggestionJob,
} from "@linkrowth/db";
import type { ClarificationSummary, FeedPostInput } from "../types/suggestions";

function toAgentPost(feedPost: PostInput): Post {
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

function toAnsweredClarification(
  clarification: ClarificationSummary,
  answer: string
) {
  return {
    status: "answered" as const,
    question: clarification.question?.trim() || undefined,
    reason: clarification.reason?.trim() || undefined,
    answer,
    answeredAt: new Date().toISOString(),
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
  });

  if (outcome.kind === "awaiting_clarification") {
    console.log(
      "[api] suggestion job awaiting clarification",
      jobId,
      outcome.clarification.question
    );
  }
}

/**
 * Claim an awaiting-clarification job and attach the user's answer.
 * Call this synchronously from the HTTP handler before returning 202 so
 * clients polling the job see `running` instead of settling on pause again.
 */
export async function claimClarificationResume(
  jobId: string,
  answer: string
): Promise<
  | { ok: true; resumed: ResumedSuggestionJob }
  | { ok: false; error: string }
> {
  const resumed = await resumeSuggestionJobWithAnswer(jobId, answer);
  if (!resumed) {
    return {
      ok: false,
      error: "Job is not awaiting clarification or checkpoint is missing",
    };
  }
  return { ok: true, resumed };
}

/**
 * Continue engage from a claimed clarification resume (skipClaim).
 * Fire-and-forget after claimClarificationResume succeeds.
 */
export async function continueSuggestionJobAfterClarification(
  resumed: ResumedSuggestionJob,
  answer: string
): Promise<void> {
  const outcome = await runEngageWithStatus(toAgentPost(resumed.post), {
    jobId: resumed.jobId,
    skipClaim: true,
    clarification: toAnsweredClarification(resumed.clarification, answer),
    // Analysis was validated when the job was paused for clarification.
    analysis: resumed.checkpoint.analysis as never,
  });

  if (outcome.kind === "awaiting_clarification") {
    console.log(
      "[api] suggestion job awaiting clarification again after resume",
      resumed.jobId,
      outcome.clarification.question
    );
  }
}
