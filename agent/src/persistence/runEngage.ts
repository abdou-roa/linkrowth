import { randomUUID } from "node:crypto";
import { MULTI_STEP_ENGAGE_AGENT_ID } from "../agents/multiStepEngage";
import { getAgent } from "../agents/registry";
import { loadUserContext } from "../context/loadUserContext";
import type { Post, UserContext } from "../core/types";
import {
  claimSuggestionJob,
  failSuggestionJob,
  JobNotClaimableError,
} from "./jobStatus";
import { createPostgresRunRepository } from "./postgresRepository";
import type { RunRecord, RunRepository } from "./types";

export { MULTI_STEP_ENGAGE_AGENT_ID };

export interface RunEngageOptions {
  context?: UserContext;
  repository?: RunRepository;
  /** Which agent pipeline to run. Defaults to multi-step (override via agentId or LINKROWTH_AGENT). */
  agentId?: string;
  /** Existing suggestion_jobs row from the API. Skips claim when the caller already claimed it. */
  jobId?: string;
  /** When true with jobId, skip the queued → running claim (caller already claimed). */
  skipClaim?: boolean;
}

/**
 * Persistence wrapper around the engage agents: resolve context, claim the job,
 * run the selected agent, persist the run, and reconcile job status on failure.
 * The agents and the pure core know nothing about any of this.
 */
export async function runEngage(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunRecord> {
  const context = options.context ?? loadUserContext();
  const repository = options.repository ?? createPostgresRunRepository();
  const agent = getAgent(
    options.agentId ?? process.env.LINKROWTH_AGENT ?? MULTI_STEP_ENGAGE_AGENT_ID
  );
  const { jobId } = options;

  if (jobId && !options.skipClaim) {
    const claimed = await claimSuggestionJob(jobId);
    if (!claimed) {
      throw new JobNotClaimableError(jobId);
    }
  }

  const postId = post.id ?? randomUUID();

  try {
    const { result, steps, agentId } = await agent.run({ post, context });
    const createdAt = new Date().toISOString();

    const record: RunRecord = {
      id: randomUUID(),
      jobId,
      postId,
      agentId,
      post: { ...post, id: postId },
      result,
      steps,
      createdAt,
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
