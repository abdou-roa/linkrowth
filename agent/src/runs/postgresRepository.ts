import type { Pool, QueryResultRow } from "pg";
import type { ReasoningStep } from "../agents/types";
import { getPool } from "../db/client";
import type { EngageResult, Post } from "../types";
import type { RunRecord, RunRepository } from "./types";

interface RunJoinRow extends QueryResultRow {
  id: string;
  post_id: string;
  agent_id: string;
  suggestion: string;
  rationale: string;
  category: string | null;
  core_subject: string | null;
  applied_playbook: string | null;
  value_hook: string | null;
  voice_check: string | null;
  steps: ReasoningStep[] | string;
  created_at: Date;
  post_text: string;
  author_name: string | null;
  author_role: string | null;
}

function parseSteps(raw: ReasoningStep[] | string): ReasoningStep[] {
  if (Array.isArray(raw)) return raw;
  return JSON.parse(raw) as ReasoningStep[];
}

function rowToRecord(row: RunJoinRow): RunRecord {
  const post: Post = {
    id: row.post_id,
    text: row.post_text,
  };
  if (row.author_name || row.author_role) {
    post.author = {
      name: row.author_name ?? undefined,
      role: row.author_role ?? undefined,
    };
  }

  const result: EngageResult = {
    suggestion: row.suggestion,
    rationale: row.rationale,
    category: row.category ?? undefined,
    coreSubject: row.core_subject ?? undefined,
    appliedPlaybook: row.applied_playbook ?? undefined,
    valueHook: row.value_hook ?? undefined,
    voiceCheck: row.voice_check ?? undefined,
  };

  return {
    id: row.id,
    postId: row.post_id,
    agentId: row.agent_id,
    post,
    result,
    steps: parseSteps(row.steps),
    createdAt: row.created_at.toISOString(),
  };
}

const RUN_SELECT = `
  SELECT
    r.id,
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
    p.author_name,
    p.author_role
  FROM runs r
  INNER JOIN posts p ON p.id = r.post_id
`;

export class PostgresRunRepository implements RunRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async save(run: RunRecord): Promise<RunRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO posts (id, text, author_name, author_role, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           text = EXCLUDED.text,
           author_name = EXCLUDED.author_name,
           author_role = EXCLUDED.author_role`,
        [
          run.postId,
          run.post.text,
          run.post.author?.name ?? null,
          run.post.author?.role ?? null,
          run.createdAt,
        ]
      );

      await client.query(
        `INSERT INTO runs (
           id, post_id, agent_id,
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
      return run;
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
