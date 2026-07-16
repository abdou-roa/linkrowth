-- Linkrowth API schema: posts, suggestion_jobs, suggestion_runs
-- Source of truth: docs/database-schema.md

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  url TEXT,
  text TEXT NOT NULL,
  author_name TEXT,
  author_headline TEXT,
  author_profile_url TEXT,
  author_username TEXT,
  likes INT,
  comments_count INT,
  comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  age_text TEXT,
  extracted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suggestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  priority INT NOT NULL DEFAULT 0,
  triage JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one active (queued or running) job per post
CREATE UNIQUE INDEX IF NOT EXISTS suggestion_jobs_one_active_per_post
  ON suggestion_jobs (post_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS suggestion_jobs_status_priority_idx
  ON suggestion_jobs (status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS suggestion_jobs_post_id_idx
  ON suggestion_jobs (post_id);

CREATE TABLE IF NOT EXISTS suggestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES suggestion_jobs (id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  agent_id TEXT,
  suggestion TEXT,
  rationale TEXT,
  category TEXT,
  core_subject TEXT,
  applied_playbook TEXT,
  value_hook TEXT,
  voice_check TEXT,
  steps JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suggestion_runs_job_id_idx ON suggestion_runs (job_id);
CREATE INDEX IF NOT EXISTS suggestion_runs_post_id_idx ON suggestion_runs (post_id);
CREATE INDEX IF NOT EXISTS suggestion_runs_created_at_idx ON suggestion_runs (created_at DESC);
