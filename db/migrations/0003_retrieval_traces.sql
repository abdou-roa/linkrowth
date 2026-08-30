-- Retrieval traces: one row per retrieval attempt, for benchmarking/evaluation.
-- Deliberately JSONB-heavy so retrieval/scoring changes evolve the payload
-- (params / candidates[].signals) without schema migrations. run_id/job_id are
-- nullable so traces survive failed or paused runs; post_id has no FK so a trace
-- outlives its post.
CREATE TABLE IF NOT EXISTS retrieval_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES suggestion_runs (id) ON DELETE SET NULL,
  job_id UUID REFERENCES suggestion_jobs (id) ON DELETE SET NULL,
  post_id TEXT,
  agent_id TEXT,
  schema_version INT NOT NULL,
  outcome TEXT NOT NULL,
  query_text TEXT,
  index_meta JSONB,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  injected_proof_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  timings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retrieval_traces_run_id_idx ON retrieval_traces (run_id);
CREATE INDEX IF NOT EXISTS retrieval_traces_post_id_idx ON retrieval_traces (post_id);
CREATE INDEX IF NOT EXISTS retrieval_traces_outcome_idx ON retrieval_traces (outcome);
CREATE INDEX IF NOT EXISTS retrieval_traces_created_at_idx ON retrieval_traces (created_at DESC);
