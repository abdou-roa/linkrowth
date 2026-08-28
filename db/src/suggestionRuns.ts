import { getPool } from "./client";
import { upsertPost } from "./posts";
import type {
  SaveSuggestionRunInput,
  SavedSuggestionRun,
} from "./types";

export async function saveSuggestionRun(
  run: SaveSuggestionRunInput
): Promise<SavedSuggestionRun> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await upsertPost(client, run.post);

    let jobId = run.jobId;
    if (!jobId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO suggestion_jobs (
           post_id, status, started_at, finished_at
         ) VALUES ($1, 'succeeded', $2::timestamptz, $2::timestamptz)
         RETURNING id`,
        [run.postId, run.createdAt]
      );
      jobId = inserted.rows[0].id;
    }

    await client.query(
      `INSERT INTO suggestion_runs (
         id, job_id, post_id,
         suggestion, rationale,
         category, core_subject, applied_playbook, value_hook, voice_check,
         steps, created_at
       ) VALUES (
         $1, $2, $3,
         $4, $5,
         $6, $7, $8, $9, $10,
         $11::jsonb, $12
       )`,
      [
        run.id,
        jobId,
        run.postId,
        run.result.suggestion,
        run.result.rationale,
        run.result.category ?? null,
        run.result.coreSubject ?? null,
        run.result.appliedPlaybook ?? null,
        run.result.valueHook ?? null,
        run.result.voiceCheck ?? null,
        JSON.stringify(run.steps),
        run.createdAt,
      ]
    );

    if (run.jobId) {
      await client.query(
        `UPDATE suggestion_jobs
         SET status = 'succeeded', finished_at = $2::timestamptz, error = NULL
         WHERE id = $1`,
        [run.jobId, run.createdAt]
      );
    }

    await client.query("COMMIT");
    return { ...run, jobId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
