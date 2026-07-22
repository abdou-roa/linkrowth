import { randomUUID } from "node:crypto";
import { engage, ENGAGE_AGENT_ID } from "../core/engage";
import { loadUserContext } from "../context/loadUserContext";
import type { Post, UserContext } from "../core/types";
import {
  claimSuggestionJob,
  failSuggestionJob,
  JobNotClaimableError,
} from "./jobStatus";
import { createPostgresRunRepository } from "./postgresRepository";
import type { ReasoningStep, RunRecord, RunRepository } from "./types";

export interface RunEngageOptions {
  context?: UserContext;
  repository?: RunRepository;
  /** Existing suggestion_jobs row from the API. Skips claim when the caller already claimed it. */
  jobId?: string;
  /** When true with jobId, skip the queued → running claim (caller already claimed). */
  skipClaim?: boolean;
}

/**
 * Persistence wrapper around the engage core: resolve context, claim the job,
 * run engage(), persist the run, and reconcile job status on failure. The core
 * engage() knows nothing about any of this.
 */
export async function runEngage(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunRecord> {
  const context = options.context ?? loadUserContext();
  const repository = options.repository ?? createPostgresRunRepository();
  const { jobId } = options;

  if (jobId && !options.skipClaim) {
    const claimed = await claimSuggestionJob(jobId);
    if (!claimed) {
      throw new JobNotClaimableError(jobId);
    }
  }

  const postId = post.id ?? randomUUID();

  try {
    const startedAt = new Date().toISOString();
    const result = await engage(post, context);
    const completedAt = new Date().toISOString();

    const steps: ReasoningStep[] = [
      {
        name: "engage_oneshot",
        status: "completed",
        summary: "Single-prompt engage completed",
        output: result,
        startedAt,
        completedAt,
      },
    ];

    const record: RunRecord = {
      id: randomUUID(),
      jobId,
      postId,
      agentId: ENGAGE_AGENT_ID,
      post: { ...post, id: postId },
      result,
      steps,
      createdAt: completedAt,
    };

    return await repository.save(record);
  } catch (err) {
    if (jobId && !(err instanceof JobNotClaimableError)) {
      const message = err instanceof Error ? err.message : String(err);
      await failSuggestionJob(jobId, message);
    }
    throw err;
  }
}
