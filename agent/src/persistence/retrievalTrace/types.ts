/**
 * Stable, change-tolerant contract for retrieval traces.
 *
 * The persistence layer (schema + repository) depends ONLY on these types, never
 * on retrieval internals. When retrieval/scoring logic changes, evolve the open
 * `params` / `signals` bags instead of the columns; bump SCHEMA_VERSION only if
 * the top-level contract itself changes so readers can branch on it.
 */

/** Bump only when the RetrievalTrace shape (not scoring internals) changes. */
export const RETRIEVAL_TRACE_SCHEMA_VERSION = 4;

/** Terminal state of a single retrieval attempt. */
export type RetrievalOutcome =
  | "injected"
  | "empty_query"
  | "no_index"
  | "embed_failed"
  | "no_survivors"
  | "abstained";

/** Why a ranked candidate did not become a proof point. */
export type RetrievalDropReason =
  | "shareability"
  | "confidence"
  | "min_score"
  | "generation_relevance"
  | "evidence_score"
  | "missing_index_item"
  | "duplicate_claim"
  | "empty_claim"
  | "over_k";

export interface RetrievalIndexMeta {
  provider: string;
  model: string;
  dimensions: number;
  indexedAt: string;
  count: number;
  /** SQLite index schema version. 1 = single vector; 2 = split vectors; 3 = split + FTS5. */
  schemaVersion?: number;
}

export interface RetrievalTraceHit {
  artifactId: string;
  score: number;
  /** Position in the raw cosine ranking (0-based). */
  rank: number;
  /** True when the hit survived every filter and became a proof point. */
  selected: boolean;
  dropReason?: RetrievalDropReason;
  /** True when hard eligibility excluded the artifact before a channel pool cap. */
  prefiltered?: boolean;
  claimableLine?: string;
  /**
   * Situation cosine when strategy=split (same as score in that mode; explicit
   * for readability when both channels are recorded).
   */
  situationScore?: number;
  /** Evidence cosine against the analysis-derived query (split strategy, Phase 2+). */
  evidenceScore?: number;
  /** 1-indexed position in the situation-semantic list (hybrid strategy, Phase 3). */
  semanticRank?: number;
  /** 1-indexed position in the BM25 list (hybrid strategy, Phase 3). */
  lexicalRank?: number;
  /** Raw SQLite bm25() value (hybrid strategy, Phase 3). */
  bm25Score?: number;
  /** RRF combined score (hybrid strategy, Phase 3). */
  rrfScore?: number;
  /** Future scoring signals (rerank score, hybrid weights, ...). Free-form on purpose. */
  signals?: Record<string, unknown>;
}

/**
 * A single retrieval attempt, produced by the retrieval layer. Run/job/agent
 * identity is attached separately at persist time (see RetrievalTraceRefs) so
 * retrieval stays unaware of persistence concerns.
 */
export interface RetrievalTrace {
  schemaVersion: number;
  outcome: RetrievalOutcome;
  query: {
    /** Situation text that was (or would have been) embedded. */
    text: string;
    /** Author headline, recorded but not mixed into `text`. */
    headline?: string;
    /**
     * Evidence query derived from AnalysisArtifact when available (split strategy).
     * Not embedded in Phase 2 production path; used for offline evaluation and
     * trace annotation when analysis is passed via RetrieveContextOptions.
     */
    evidenceText?: string;
  };
  /** Null when no index was loaded (missing index / empty query). */
  index: RetrievalIndexMeta | null;
  /** Config knobs in effect (k, minScore, strategy, and future retrieval params). */
  params: Record<string, unknown>;
  /** Every ranked candidate considered, selected or not. */
  candidates: RetrievalTraceHit[];
  injectedProofPoints: string[];
  timings?: {
    embedMs?: number;
    evidenceEmbedMs?: number;
    lexicalMs?: number;
    candidateGenerationMs?: number;
    rerankMs?: number;
    totalMs?: number;
  };
}

/** Run/job/agent linkage supplied by persistence, not by retrieval. */
export interface RetrievalTraceRefs {
  agentId?: string;
  runId?: string;
  jobId?: string;
  postId?: string;
}

/**
 * Where retrieval emits a finished trace. The default is a no-op; runEngage
 * injects a capturing sink and persists via RetrievalTraceRepository. Retrieval
 * depends on this interface only, never on the database.
 */
export interface RetrievalTraceSink {
  record(trace: RetrievalTrace): void | Promise<void>;
}

export interface RetrievalTraceRepository {
  save(trace: RetrievalTrace, refs: RetrievalTraceRefs): Promise<void>;
}

/** Sink that discards traces. Used when retrieval runs without persistence. */
export const noopTraceSink: RetrievalTraceSink = {
  record() {
    /* discard */
  },
};
