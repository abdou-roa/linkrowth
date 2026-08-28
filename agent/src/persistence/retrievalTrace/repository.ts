import type { Pool } from "pg";
import { getPool } from "../../config/db";
import type {
  RetrievalTrace,
  RetrievalTraceRefs,
  RetrievalTraceRepository,
} from "./types";

/**
 * Persists retrieval traces to Postgres (retrieval_traces table). This is the
 * only trace code that knows about the database; retrieval depends solely on the
 * RetrievalTraceSink interface.
 */
export class PostgresRetrievalTraceRepository implements RetrievalTraceRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async save(trace: RetrievalTrace, refs: RetrievalTraceRefs): Promise<void> {
    await this.pool.query(
      `INSERT INTO retrieval_traces (
         run_id, job_id, post_id, agent_id,
         schema_version, outcome, query_text,
         index_meta, params, candidates, injected_proof_points, timings
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb
       )`,
      [
        refs.runId ?? null,
        refs.jobId ?? null,
        refs.postId ?? null,
        refs.agentId ?? null,
        trace.schemaVersion,
        trace.outcome,
        trace.query.text,
        trace.index ? JSON.stringify(trace.index) : null,
        JSON.stringify(trace.params ?? {}),
        JSON.stringify(trace.candidates ?? []),
        JSON.stringify(trace.injectedProofPoints ?? []),
        trace.timings ? JSON.stringify(trace.timings) : null,
      ]
    );
  }
}

/** Discards traces. Default when persistence is disabled. */
export class NoopRetrievalTraceRepository implements RetrievalTraceRepository {
  async save(): Promise<void> {
    /* discard */
  }
}

/** Keeps traces in memory. For tests and inspection. */
export class InMemoryRetrievalTraceRepository implements RetrievalTraceRepository {
  readonly saved: Array<{ trace: RetrievalTrace; refs: RetrievalTraceRefs }> = [];

  async save(trace: RetrievalTrace, refs: RetrievalTraceRefs): Promise<void> {
    this.saved.push({ trace, refs });
  }
}

function traceEnabled(): boolean {
  const raw = process.env.LINKROWTH_RETRIEVAL_TRACE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Select the trace repository from env. LINKROWTH_RETRIEVAL_TRACE enables the
 * Postgres sink; unset/falsey yields a no-op so retrieval works without a DB.
 */
export function createRetrievalTraceRepository(): RetrievalTraceRepository {
  return traceEnabled()
    ? new PostgresRetrievalTraceRepository()
    : new NoopRetrievalTraceRepository();
}
