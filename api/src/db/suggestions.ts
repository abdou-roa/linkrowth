import type { PoolClient } from "pg";
import { getPool } from "./client";
import type {
  FeedPostInput,
  GetSuggestionResponse,
  SuggestionJobStatus,
  TriageInput,
} from "../types/suggestions";

export interface CreatedJob {
  jobId: string;
  postId: string;
  status: SuggestionJobStatus;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    String((err as { code: unknown }).code) === "23505"
  );
}

async function upsertPost(client: PoolClient, post: FeedPostInput): Promise<void> {
  const extractedAt = post.extractedAt ? new Date(post.extractedAt) : null;
  const comments = JSON.stringify(post.comments ?? []);

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
      post.id,
      post.url ?? null,
      post.text,
      post.author?.name ?? null,
      post.author?.headline ?? null,
      post.author?.profileUrl ?? null,
      post.author?.username ?? null,
      post.metrics?.likes ?? null,
      post.metrics?.commentsCount ?? null,
      comments,
      post.ageText ?? null,
      extractedAt && !Number.isNaN(extractedAt.getTime())
        ? extractedAt.toISOString()
        : null,
    ]
  );
}

async function findActiveJob(
  client: PoolClient,
  postId: string
): Promise<CreatedJob | null> {
  const result = await client.query<{
    id: string;
    post_id: string;
    status: SuggestionJobStatus;
  }>(
    `SELECT id, post_id, status
     FROM suggestion_jobs
     WHERE post_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [postId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { jobId: row.id, postId: row.post_id, status: row.status };
}

/**
 * Upsert the feed post and enqueue a suggestion job.
 * If an active (queued/running) job already exists for the post, returns that job.
 */
export async function createSuggestionJob(
  post: FeedPostInput,
  triage?: TriageInput
): Promise<CreatedJob> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await upsertPost(client, post);
    await client.query("SAVEPOINT sp_job");

    try {
      const inserted = await client.query<{
        id: string;
        post_id: string;
        status: SuggestionJobStatus;
      }>(
        `INSERT INTO suggestion_jobs (post_id, status, triage)
         VALUES ($1, 'queued', $2::jsonb)
         RETURNING id, post_id, status`,
        [post.id, triage ? JSON.stringify(triage) : null]
      );
      await client.query("COMMIT");
      const row = inserted.rows[0];
      return { jobId: row.id, postId: row.post_id, status: row.status };
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // Keep the post upsert; return the existing active job.
      await client.query("ROLLBACK TO SAVEPOINT sp_job");
      const existing = await findActiveJob(client, post.id);
      await client.query("COMMIT");
      if (!existing) {
        throw new Error(
          `Active suggestion job conflict for post ${post.id}, but none found`
        );
      }
      return existing;
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore if no open transaction */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function getSuggestionJob(
  jobId: string
): Promise<GetSuggestionResponse | null> {
  const result = await getPool().query<{
    id: string;
    post_id: string;
    status: SuggestionJobStatus;
    error: string | null;
    suggestion: string | null;
    rationale: string | null;
    category: string | null;
    agent_id: string | null;
    has_run: boolean;
  }>(
    `SELECT
       j.id,
       j.post_id,
       j.status,
       j.error,
       r.suggestion,
       r.rationale,
       r.category,
       r.agent_id,
       (r.id IS NOT NULL) AS has_run
     FROM suggestion_jobs j
     LEFT JOIN LATERAL (
       SELECT id, suggestion, rationale, category, agent_id
       FROM suggestion_runs
       WHERE job_id = j.id
       ORDER BY created_at DESC
       LIMIT 1
     ) r ON TRUE
     WHERE j.id = $1`,
    [jobId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    jobId: row.id,
    postId: row.post_id,
    status: row.status,
    error: row.error,
    run: row.has_run
      ? {
          suggestion: row.suggestion,
          rationale: row.rationale,
          category: row.category,
          agentId: row.agent_id,
        }
      : null,
  };
}
