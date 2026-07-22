import { getPool } from "../config/db";

export class JobNotClaimableError extends Error {
  constructor(jobId: string) {
    super(`Suggestion job ${jobId} is not queued`);
    this.name = "JobNotClaimableError";
  }
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
