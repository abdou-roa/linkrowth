import { randomUUID } from "node:crypto";
import { MULTI_STEP_ENGAGE_AGENT_ID } from "../agents/multiStepEngage";
import { getAgent } from "../agents/registry";
import { loadUserContext } from "../context/loadUserContext";
import { retrieveContext } from "../context/retrieveContext";
import type { Post, UserContext } from "../core/types";
import type { AnalysisArtifact, HumanClarification } from "../steps/types";
import {
  claimSuggestionJob,
  failSuggestionJob,
  JobNotClaimableError,
  pauseSuggestionJobForClarification,
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
  /** Optional clarification for resume (answered) or seed. */
  clarification?: HumanClarification;
  /** Analysis checkpoint used with an answered clarification on resume. */
  analysis?: AnalysisArtifact;
}

export type RunEngageOutcome =
  | { kind: "completed"; run: RunRecord }
  | {
      kind: "awaiting_clarification";
      jobId?: string;
      agentId: string;
      clarification: HumanClarification;
      steps: RunRecord["steps"];
    };

/**
 * Persistence wrapper around the engage agents: resolve context, claim the job,
 * run the selected agent, persist the run, and reconcile job status on failure.
 * The agents and the pure core know nothing about any of this.
 */
export async function runEngage(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunRecord> {
  const outcome = await runEngageWithStatus(post, options);
  if (outcome.kind === "awaiting_clarification") {
    // Callers that only expect a completed RunRecord treat pause as a soft stop.
    // Prefer runEngageWithStatus when you need to handle HITL explicitly.
    throw new Error(
      `Suggestion requires clarification${
        outcome.clarification.question
          ? `: ${outcome.clarification.question}`
          : ""
      }`
    );
  }
  return outcome.run;
}

/**
 * Like runEngage, but returns a discriminated outcome so API/workers can pause
 * for human clarification without treating it as failure.
 */
export async function runEngageWithStatus(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunEngageOutcome> {
  // Context chokepoint: callers that pass context skip retrieval (tests / overrides).
  // Otherwise load the static persona and enrich it from the experience index.
  let context: UserContext;
  if (options.context) {
    context = options.context;
    console.log(
      "[runEngage] context supplied by caller; retrieval skipped"
    );
  } else {
    const baseContext = loadUserContext();
    context = await retrieveContext(post, baseContext);
    const baseProofKeys = new Set(
      (baseContext.proofPoints ?? []).map((line) => line.trim().toLowerCase())
    );
    const injected = (context.proofPoints ?? []).filter(
      (line) => !baseProofKeys.has(line.trim().toLowerCase())
    );
    console.log(
      `[runEngage] retrieval injected ${injected.length} proof point(s) before agent run:`,
      injected.length > 0 ? injected : "(none — static user.json only)"
    );
  }
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
    const outcome = await agent.run({
      post,
      context,
      clarification: options.clarification,
      analysis: options.analysis,
    });

    if (outcome.status === "awaiting_clarification") {
      if (!outcome.clarification || !outcome.analysis) {
        throw new Error(
          "Agent paused for clarification but did not return clarification + analysis"
        );
      }

      if (jobId) {
        await pauseSuggestionJobForClarification(jobId, {
          agentId: outcome.agentId,
          analysis: outcome.analysis,
          clarification: outcome.clarification,
          steps: outcome.steps,
        });
      }

      return {
        kind: "awaiting_clarification",
        jobId,
        agentId: outcome.agentId,
        clarification: outcome.clarification,
        steps: outcome.steps,
      };
    }

    if (!outcome.result) {
      throw new Error("Agent completed without a result");
    }

    const createdAt = new Date().toISOString();

    const record: RunRecord = {
      id: randomUUID(),
      jobId,
      postId,
      agentId: outcome.agentId,
      post: { ...post, id: postId },
      result: outcome.result,
      steps: outcome.steps,
      createdAt,
    };

    return { kind: "completed", run: await repository.save(record) };
  } catch (err) {
    if (jobId && !(err instanceof JobNotClaimableError)) {
      const message = err instanceof Error ? err.message : String(err);
      await failSuggestionJob(jobId, message);
    }
    throw err;
  }
}
