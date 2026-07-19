import type { Pool, QueryResultRow } from "pg";
import type { ReasoningStep } from "../agents/types";
import { getPool } from "../db/client";
import type { EngageResult, Post, PostComment } from "../types";
import type { RunRecord, RunRepository } from "./types";

interface RunJoinRow extends QueryResultRow {
  id: string;
  job_id: string;
  post_id: string;
  agent_id: string | null;
  suggestion: string | null;
  rationale: string | null;
  category: string | null;
  core_subject: string | null;
  applied_playbook: string | null;
  value_hook: string | null;
  voice_check: string | null;
  steps: ReasoningStep[] | string;
  created_at: Date;
  post_text: string;
  post_url: string | null;
  author_name: string | null;
  author_headline: string | null;
  author_profile_url: string | null;
  author_username: string | null;
  likes: number | null;
  comments_count: number | null;
  comments: PostComment[] | string;
  age_text: string | null;
  extracted_at: Date | null;
}

function parseSteps(raw: ReasoningStep[] | string): ReasoningStep[] {
  if (Array.isArray(raw)) return raw;
  return JSON.parse(raw) as ReasoningStep[];
}

function parseComments(raw: PostComment[] | string): PostComment[] {
  if (Array.isArray(raw)) return raw;
  return JSON.parse(raw) as PostComment[];
}

function rowToRecord(row: RunJoinRow): RunRecord {
  const comments = parseComments(row.comments);
  const post: Post = {
    id: row.post_id,
    text: row.post_text,
  };

  if (row.post_url) post.url = row.post_url;
  if (row.author_name || row.author_headline || row.author_profile_url || row.author_username) {
    post.author = {
      name: row.author_name ?? undefined,
      headline: row.author_headline ?? undefined,
      profileUrl: row.author_profile_url ?? undefined,
      username: row.author_username ?? undefined,
    };
  }
  if (row.likes != null || row.comments_count != null) {
    post.metrics = {
      likes: row.likes ?? undefined,
      commentsCount: row.comments_count ?? undefined,
    };
  }
  if (comments.length > 0) post.comments = comments;
  if (row.age_text) post.ageText = row.age_text;
  if (row.extracted_at) post.extractedAt = row.extracted_at.toISOString();

  const result: EngageResult = {
    suggestion: row.suggestion ?? "",
    rationale: row.rationale ?? "",
    category: row.category ?? undefined,
    coreSubject: row.core_subject ?? undefined,
    appliedPlaybook: row.applied_playbook ?? undefined,
    valueHook: row.value_hook ?? undefined,
    voiceCheck: row.voice_check ?? undefined,
  };

  return {
    id: row.id,
    jobId: row.job_id,
    postId: row.post_id,
    agentId: row.agent_id ?? "",
    post,
    result,
    steps: parseSteps(row.steps),
    createdAt: row.created_at.toISOString(),
  };
}

const RUN_SELECT = `
  SELECT
    r.id,
    r.job_id,
    r.post_id,
    r.agent_id,
    r.suggestion,
    r.rationale,
    r.category,
    r.core_subject,
    r.applied_playbook,
    r.value_hook,
    r.voice_check,
    r.steps,
    r.created_at,
    p.text AS post_text,
    p.url AS post_url,
    p.author_name,
    p.author_headline,
    p.author_profile_url,
    p.author_username,
    p.likes,
    p.comments_count,
    p.comments,
    p.age_text,
    p.extracted_at
  FROM suggestion_runs r
  INNER JOIN posts p ON p.id = r.post_id
`;

export class PostgresRunRepository implements RunRepository {
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

  async getById(id: string): Promise<RunRecord | null> {
    const result = await this.pool.query<RunJoinRow>(
      `${RUN_SELECT} WHERE r.id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }

  async list(limit = 50): Promise<RunRecord[]> {
    const result = await this.pool.query<RunJoinRow>(
      `${RUN_SELECT} ORDER BY r.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToRecord);
  }
}

export function createPostgresRunRepository(): PostgresRunRepository {
  return new PostgresRunRepository();
}
