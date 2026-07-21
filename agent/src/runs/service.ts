import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgent } from "../agents/registry";
import { getAgentRoot } from "../paths";
import type { Post, UserContext } from "../types";
import {
  claimSuggestionJob,
  failSuggestionJob,
  JobNotClaimableError,
} from "./jobStatus";
import { createPostgresRunRepository } from "./postgresRepository";
import type { RunRecord, RunRepository } from "./types";

function loadUserContext(): UserContext {
  const configPath = join(getAgentRoot(), "config", "user.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing agent/config/user.json. Copy agent/config/user.example.json and fill in your voice and substance fields."
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as UserContext;
}

export interface RunEngageOptions {
  context?: UserContext;
  repository?: RunRepository;
  agentId?: string;
  /** Existing suggestion_jobs row from the API. Skips claim when the caller already claimed it. */
  jobId?: string;
  /** When true with jobId, skip the queued → running claim (caller already claimed). */
  skipClaim?: boolean;
}

export async function runEngage(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunRecord> {
  const context = options.context ?? loadUserContext();
  const repository = options.repository ?? createPostgresRunRepository();
  const agent = getAgent(options.agentId);
  const { jobId } = options;

  if (jobId && !options.skipClaim) {
    const claimed = await claimSuggestionJob(jobId);
    if (!claimed) {
      throw new JobNotClaimableError(jobId);
    }
  }

  const postId = post.id ?? randomUUID();

  try {
    const agentResult = await agent.run({ post, context });
    const createdAt = new Date().toISOString();

    const record: RunRecord = {
      id: randomUUID(),
      jobId,
      postId,
      agentId: agentResult.agentId,
      post: { ...post, id: postId },
      result: agentResult.result,
      steps: agentResult.steps,
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
