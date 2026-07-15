-- Linkrowth persistence: posts + runs (steps as jsonb)

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  author_name TEXT,
  author_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  rationale TEXT NOT NULL,
  category TEXT,
  core_subject TEXT,
  applied_playbook TEXT,
  value_hook TEXT,
  voice_check TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs (created_at DESC);
CREATE INDEX IF NOT EXISTS runs_post_id_idx ON runs (post_id);
CREATE INDEX IF NOT EXISTS runs_agent_id_idx ON runs (agent_id);
