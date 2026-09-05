import type { PoolClient } from "pg";
import { getPool } from "./client";
import { upsertPost } from "./posts";
import type {
  ClarificationCheckpointInput,
  ClarificationSummary,
  CreatedSuggestionJob,
  JobCheckpoint,
  PostInput,
  ResumedSuggestionJob,
  SuggestionJobResult,
  SuggestionJobStatus,
  TriageInput,
} from "./types";

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    String((error as { code: unknown }).code) === "23505"
  );
}

async function findActiveJob(
  client: PoolClient,
  postId: string
): Promise<CreatedSuggestionJob | null> {
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
  return row
    ? { jobId: row.id, postId: row.post_id, status: row.status }
    : null;
}

export async function createSuggestionJob(
  post: PostInput,
  triage?: TriageInput,
  notes?: string
): Promise<CreatedSuggestionJob> {
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
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

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
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be closed.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getSuggestionJob(
  jobId: string
): Promise<SuggestionJobResult | null> {
  const result = await getPool().query<{
    id: string;
    post_id: string;
    status: SuggestionJobStatus;
    error: string | null;
    clarification: ClarificationSummary | null;
    suggestion: string | null;
    rationale: string | null;
    category: string | null;
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
       (r.id IS NOT NULL) AS has_run
     FROM suggestion_jobs j
     LEFT JOIN LATERAL (
       SELECT id, suggestion, rationale, category
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
        }
      : null,
  };
}

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

export async function failSuggestionJob(
  jobId: string,
  error: string
): Promise<void> {
  await getPool().query(
    `UPDATE suggestion_jobs
     SET status = 'failed', finished_at = NOW(), error = $2
     WHERE id = $1`,
    [jobId, error.slice(0, 2000)]
  );
}

export async function pauseSuggestionJobForClarification(
  jobId: string,
  checkpoint: ClarificationCheckpointInput
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
        analysis: checkpoint.analysis,
        steps: checkpoint.steps,
        retrievalShortlist: checkpoint.retrievalShortlist,
      }),
    ]
  );
}

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
    comments: PostInput["comments"] | null;
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
  if (!row?.checkpoint || !row.clarification) return null;
  if (row.checkpoint.analysis == null) return null;

  return {
    jobId: row.id,
    post: {
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
    },
    checkpoint: row.checkpoint,
    clarification: row.clarification,
  };
}
