-- Retrieval trace schema v2 (Phase 2: split semantic fields).
--
-- Query provenance is stored in dedicated nullable columns because query_text
-- contains only the embedded situation query. Existing v1 rows remain valid.
ALTER TABLE retrieval_traces
  ADD COLUMN IF NOT EXISTS query_headline TEXT,
  ADD COLUMN IF NOT EXISTS query_evidence_text TEXT;

COMMENT ON COLUMN retrieval_traces.query_text IS
  'Situation query text that was (or would have been) embedded.';
COMMENT ON COLUMN retrieval_traces.query_headline IS
  'Author headline recorded separately; never mixed into query_text.';
COMMENT ON COLUMN retrieval_traces.query_evidence_text IS
  'Analysis-derived evidence query used for split-strategy scoring and evaluation.';
--
-- v2 fields added to the JSONB payloads (TypeScript types in
-- agent/src/persistence/retrievalTrace/types.ts):
--   candidates[].situationScore    number | undefined
--   candidates[].evidenceScore     number | undefined
-- Query provenance columns:
--   query_headline                 text | null
--   query_evidence_text            text | null
--   index_meta.schemaVersion       number | undefined
--   params.strategy                string ("single" | "split")
--   params.candidatePoolSize       number (split strategy)
--   timings.evidenceEmbedMs        number | undefined  (split strategy)
