BEGIN;

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
  status TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'running',
      'awaiting_clarification',
      'succeeded',
      'failed'
    )
  ),
  priority INT NOT NULL DEFAULT 0,
  triage JSONB,
  notes TEXT,
  clarification JSONB,
  checkpoint JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE suggestion_jobs ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suggestion_jobs ADD COLUMN IF NOT EXISTS clarification JSONB;
ALTER TABLE suggestion_jobs ADD COLUMN IF NOT EXISTS checkpoint JSONB;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'suggestion_jobs'
    AND nsp.nspname = current_schema()
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE suggestion_jobs DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;

  ALTER TABLE suggestion_jobs
    ADD CONSTRAINT suggestion_jobs_status_check
    CHECK (
      status IN (
        'queued',
        'running',
        'awaiting_clarification',
        'succeeded',
        'failed'
      )
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

DROP INDEX IF EXISTS suggestion_jobs_one_active_per_post;
CREATE UNIQUE INDEX suggestion_jobs_one_active_per_post
  ON suggestion_jobs (post_id)
  WHERE status IN ('queued', 'running', 'awaiting_clarification');

CREATE INDEX IF NOT EXISTS suggestion_jobs_status_priority_idx
  ON suggestion_jobs (status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS suggestion_jobs_post_id_idx
  ON suggestion_jobs (post_id);

CREATE TABLE IF NOT EXISTS suggestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES suggestion_jobs (id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS suggestion_runs_job_id_idx
  ON suggestion_runs (job_id);
CREATE INDEX IF NOT EXISTS suggestion_runs_post_id_idx
  ON suggestion_runs (post_id);
CREATE INDEX IF NOT EXISTS suggestion_runs_created_at_idx
  ON suggestion_runs (created_at DESC);

COMMIT;
