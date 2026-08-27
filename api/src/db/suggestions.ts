import type { PoolClient } from "pg";
import { getPool } from "./client";
import type {
  ClarificationSummary,
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
     WHERE post_id = $1
       AND status IN ('queued', 'running', 'awaiting_clarification')
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
  triage?: TriageInput,
  notes?: string
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
        `INSERT INTO suggestion_jobs (post_id, status, triage, notes)
         VALUES ($1, 'queued', $2::jsonb, $3)
         RETURNING id, post_id, status`,
        [
          post.id,
          triage ? JSON.stringify(triage) : null,
          notes?.trim() ? notes.trim() : null,
        ]
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
    clarification: ClarificationSummary | null;
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
       j.clarification,
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
    clarification: row.clarification ?? null,
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

/** Checkpoint stored when a job pauses for clarification. */
export interface JobCheckpoint {
  agentId: string;
  analysis: unknown;
  steps: unknown[];
}

export interface ResumedSuggestionJob {
  jobId: string;
  post: FeedPostInput;
  checkpoint: JobCheckpoint;
  clarification: ClarificationSummary;
}

/**
 * Atomically claim an awaiting-clarification job for resume: set status to
 * running and patch clarification with the user's answer.
 * Returns null if the job is missing, not awaiting clarification, or has no checkpoint.
 */
export async function resumeSuggestionJobWithAnswer(
  jobId: string,
  answer: string
): Promise<ResumedSuggestionJob | null> {
  const answeredAt = new Date().toISOString();
  const result = await getPool().query<{
    id: string;
    clarification: ClarificationSummary | null;
    checkpoint: JobCheckpoint | null;
    post_id: string;
    url: string | null;
    text: string;
    author_name: string | null;
    author_headline: string | null;
    author_profile_url: string | null;
    author_username: string | null;
    likes: number | null;
    comments_count: number | null;
    comments: FeedPostInput["comments"] | null;
    age_text: string | null;
    extracted_at: Date | null;
  }>(
    `UPDATE suggestion_jobs j
     SET status = 'running',
         clarification = jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(j.clarification, '{}'::jsonb),
               '{status}',
               '"answered"'::jsonb
             ),
             '{answer}',
             to_jsonb($2::text)
           ),
           '{answeredAt}',
           to_jsonb($3::text)
         ),
         error = NULL,
         finished_at = NULL,
         started_at = COALESCE(j.started_at, NOW())
     FROM posts p
     WHERE j.id = $1
       AND j.status = 'awaiting_clarification'
       AND j.checkpoint IS NOT NULL
       AND p.id = j.post_id
     RETURNING
       j.id,
       j.clarification,
       j.checkpoint,
       j.post_id,
       p.url,
       p.text,
       p.author_name,
       p.author_headline,
       p.author_profile_url,
       p.author_username,
       p.likes,
       p.comments_count,
       p.comments,
       p.age_text,
       p.extracted_at`,
    [jobId, answer, answeredAt]
  );

  const row = result.rows[0];
  if (!row || !row.checkpoint || !row.clarification) return null;

  const checkpoint = row.checkpoint;
  if (!checkpoint.agentId || checkpoint.analysis == null) return null;

  const post: FeedPostInput = {
    id: row.post_id,
    url: row.url ?? undefined,
    text: row.text,
    author:
      row.author_name ||
      row.author_headline ||
      row.author_profile_url ||
      row.author_username
        ? {
            name: row.author_name ?? undefined,
            headline: row.author_headline ?? undefined,
            profileUrl: row.author_profile_url ?? undefined,
            username: row.author_username ?? undefined,
          }
        : undefined,
    metrics:
      row.likes != null || row.comments_count != null
        ? {
            likes: row.likes ?? undefined,
            commentsCount: row.comments_count ?? undefined,
          }
        : undefined,
    comments: Array.isArray(row.comments) ? row.comments : undefined,
    ageText: row.age_text ?? undefined,
    extractedAt: row.extracted_at
      ? new Date(row.extracted_at).toISOString()
      : new Date().toISOString(),
  };

  return {
    jobId: row.id,
    post,
    checkpoint,
    clarification: row.clarification,
  };
}
