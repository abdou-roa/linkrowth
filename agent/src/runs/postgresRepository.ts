import type { Pool } from "pg";
import { getPool } from "../db/client";
import type { RunRecord, RunRepository } from "./types";

class PostgresRunRepository implements RunRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async save(run: RunRecord): Promise<RunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const extractedAt = run.post.extractedAt
        ? new Date(run.post.extractedAt)
        : null;
      const comments = JSON.stringify(run.post.comments ?? []);

      await client.query(
        `INSERT INTO posts (
           id, url, text,
           author_name, author_headline, author_profile_url, author_username,
           likes, comments_count, comments, age_text, extracted_at, updated_at
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6, $7,
           $8, $9, $10::jsonb, $11, $12, NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           url = EXCLUDED.url,
           text = EXCLUDED.text,
           author_name = EXCLUDED.author_name,
           author_headline = EXCLUDED.author_headline,
           author_profile_url = EXCLUDED.author_profile_url,
           author_username = EXCLUDED.author_username,
           likes = EXCLUDED.likes,
           comments_count = EXCLUDED.comments_count,
           comments = EXCLUDED.comments,
           age_text = EXCLUDED.age_text,
           extracted_at = EXCLUDED.extracted_at,
           updated_at = NOW()`,
        [
          run.postId,
          run.post.url ?? null,
          run.post.text,
          run.post.author?.name ?? null,
          run.post.author?.headline ?? null,
          run.post.author?.profileUrl ?? null,
          run.post.author?.username ?? null,
          run.post.metrics?.likes ?? null,
          run.post.metrics?.commentsCount ?? null,
          comments,
          run.post.ageText ?? null,
          extractedAt && !Number.isNaN(extractedAt.getTime())
            ? extractedAt.toISOString()
            : null,
        ]
      );

      // suggestion_runs.job_id is required. CLI engage creates a terminal job;
      // API/worker paths pass an existing jobId.
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
           id, job_id, post_id, agent_id,
           suggestion, rationale,
           category, core_subject, applied_playbook, value_hook, voice_check,
           steps, created_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6,
           $7, $8, $9, $10, $11,
           $12::jsonb, $13
         )`,
        [
          run.id,
          jobId,
          run.postId,
          run.agentId,
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

      await client.query("COMMIT");
      return { ...run, jobId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresRunRepository(): RunRepository {
  return new PostgresRunRepository();
}
