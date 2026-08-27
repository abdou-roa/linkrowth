import { getPool } from "../config/db";
import type {
  AnalysisArtifact,
  HumanClarification,
  ReasoningStep,
} from "../steps/types";

export class JobNotClaimableError extends Error {
  constructor(jobId: string) {
    super(`Suggestion job ${jobId} is not queued`);
    this.name = "JobNotClaimableError";
  }
}

/** Checkpoint saved when a run pauses for human clarification. */
export interface ClarificationCheckpoint {
  agentId: string;
  analysis: AnalysisArtifact;
  clarification: HumanClarification;
  steps: ReasoningStep[];
}

/** Atomically claim a queued job for processing. Returns false if already claimed or finished. */
export async function claimSuggestionJob(jobId: string): Promise<boolean> {
  const result = await getPool().query<{ id: string }>(
    `UPDATE suggestion_jobs
     SET status = 'running', started_at = COALESCE(started_at, NOW())
     WHERE id = $1 AND status = 'queued'
     RETURNING id`,
    [jobId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function failSuggestionJob(jobId: string, error: string): Promise<void> {
  await getPool().query(
    `UPDATE suggestion_jobs
     SET status = 'failed', finished_at = NOW(), error = $2
     WHERE id = $1`,
    [jobId, error.slice(0, 2000)]
  );
}

/**
 * Pause a running job until the user answers the analyzer's clarification.
 * Stores the question plus an analysis/steps checkpoint for resume.
 */
export async function pauseSuggestionJobForClarification(
  jobId: string,
  checkpoint: ClarificationCheckpoint
): Promise<void> {
  await getPool().query(
    `UPDATE suggestion_jobs
     SET status = 'awaiting_clarification',
         clarification = $2::jsonb,
         checkpoint = $3::jsonb,
         error = NULL,
         finished_at = NULL
     WHERE id = $1`,
    [
      jobId,
      JSON.stringify(checkpoint.clarification),
      JSON.stringify({
        agentId: checkpoint.agentId,
        analysis: checkpoint.analysis,
        steps: checkpoint.steps,
      }),
    ]
  );
}
