import { join } from "node:path";
import { getActiveProviderConfig } from "../config/llm";
import { embedQuery as defaultEmbedQuery } from "../llm";
import { getAgentRoot } from "../paths";
import type { Post, UserContext } from "../core/types";
import type { AnalysisArtifact } from "../steps/types";
import {
  buildRetrievalQuery,
  buildEvidenceQuery,
  type BuildRetrievalQueryOptions,
  type QueryConstructionTier,
  type RetrievalQuery,
} from "./queryConstruction";
import { evaluateHits, mergeProofPoints } from "./experience/select";
import {
  loadIndex as defaultLoadIndex,
  rankBySituation,
  rankIndex,
  evidenceScore as computeEvidenceScore,
} from "./experience/store";
import { EXPERIENCE_INDEX_SCHEMA_VERSION } from "./experience/types";
import type { ExperienceIndex, RankedArtifact } from "./experience/types";
import {
  RETRIEVAL_TRACE_SCHEMA_VERSION,
  noopTraceSink,
} from "../persistence/retrievalTrace/types";
import type {
  RetrievalIndexMeta,
  RetrievalOutcome,
  RetrievalTrace,
  RetrievalTraceHit,
  RetrievalTraceSink,
} from "../persistence/retrievalTrace/types";

export type EmbedQueryFn = (text: string) => Promise<number[]>;
export type LoadIndexFn = (dbPath: string) => ExperienceIndex | null;

/** Which retrieval representation to use. `single` = current baseline; `split` = Phase 2. */
export type RetrievalStrategy = "single" | "split";

export const DEFAULT_RETRIEVAL_STRATEGY: RetrievalStrategy = "single";

export function parseRetrievalStrategy(raw: string | undefined): RetrievalStrategy {
  const value = raw?.trim().toLowerCase();
  if (value === "split" || value === "2") return "split";
  return DEFAULT_RETRIEVAL_STRATEGY;
}

export function resolveRetrievalStrategy(override?: RetrievalStrategy): RetrievalStrategy {
  if (override) return override;
  return parseRetrievalStrategy(process.env.LINKROWTH_RETRIEVAL_STRATEGY);
}

export interface RetrieveContextOptions {
  /** Override path to experience-index.db. Defaults to LINKROWTH_EXPERIENCE_INDEX_DB or distill/data/. */
  indexPath?: string;
  /** Override embedQuery (tests). */
  embedQuery?: EmbedQueryFn;
  /** Override loadIndex (tests). */
  loadIndex?: LoadIndexFn;
  /** Max hits after filtering. Default LINKROWTH_RETRIEVAL_K or 5. */
  k?: number;
  /** Cosine score floor. Default LINKROWTH_RETRIEVAL_MIN_SCORE or 0.3. */
  minScore?: number;
  /** Where to emit the retrieval trace. Defaults to a no-op sink. */
  traceSink?: RetrievalTraceSink;
  /** Override query construction (`raw` baseline vs Tier A). */
  queryConstruction?: QueryConstructionTier;
  /**
   * Override retrieval strategy (`single` baseline vs `split` Phase 2).
   * Defaults to LINKROWTH_RETRIEVAL_STRATEGY or `single`.
   */
  strategy?: RetrievalStrategy;
  /**
   * Completed analysis for evidence-score annotation (split strategy, Phase 2).
   * Not used to gate selection — evidence scores are recorded in the trace only.
   * In production today, analysis runs after retrieval, so this is undefined.
   * Pass it in tests/eval harness to measure evidence-channel quality offline.
   */
  analysis?: AnalysisArtifact;
  /**
   * Candidate pool size for the split strategy (situation-channel recall pool
   * before eligibility + k cap). Defaults to LINKROWTH_RETRIEVAL_CANDIDATE_POOL
   * or k * 4.
   */
  candidatePoolSize?: number;
}

function toIndexMeta(index: ExperienceIndex): RetrievalIndexMeta {
  return {
    provider: index.embedding.provider,
    model: index.embedding.model,
    dimensions: index.embedding.dimensions,
    indexedAt: index.indexedAt,
    count: index.count,
    schemaVersion: index.schemaVersion,
  };
}

const DEFAULT_K = 5;
const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_CANDIDATE_POOL_MULTIPLIER = 4;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Default index path: sibling distill package data dir, overridable via env. */
export function defaultExperienceIndexPath(): string {
  const fromEnv = process.env.LINKROWTH_EXPERIENCE_INDEX_DB?.trim();
  if (fromEnv) return fromEnv;
  return join(getAgentRoot(), "..", "distill", "data", "experience-index.db");
}

export {
  buildRetrievalQuery,
  buildEvidenceQuery,
  type BuildRetrievalQueryOptions,
  type QueryConstructionTier,
  type RetrievalQuery,
};

function warnProviderMismatch(index: ExperienceIndex): void {
  try {
    const { provider, embedModel } = getActiveProviderConfig();
    if (index.embedding.provider && index.embedding.provider !== provider) {
      console.warn(
        `[retrieveContext] Index was built with ${index.embedding.provider}/${index.embedding.model}; ` +
          `searching with ${provider}/${embedModel}. Rebuild the index if scores look off.`
      );
    }
  } catch {
    // Active provider may be unset in unit tests that inject embedQuery — skip.
  }
}

function warnIncompatibleIndex(schemaVersion: number): boolean {
  if (schemaVersion !== EXPERIENCE_INDEX_SCHEMA_VERSION) {
    console.warn(
      `[retrieveContext] Index schema v${EXPERIENCE_INDEX_SCHEMA_VERSION} required, ` +
        `but the loaded index is v${schemaVersion}. ` +
        `Rebuild with npm run index (distill/). Falling back to static context.`
    );
    return true;
  }
  return false;
}

/**
 * Enrich UserContext with claimable proof points retrieved from the experience index.
 * Graceful: missing index, empty query, or embed failures return baseContext unchanged.
 *
 * Strategy `single` (default): unchanged cosine baseline over the combined vector.
 * Strategy `split`: rank by situation cosine; annotate traces with evidence scores.
 * Production selection is unchanged in Phase 2 — only trace data differs.
 */
export async function retrieveContext(
  post: Post,
  baseContext: UserContext,
  options: RetrieveContextOptions = {}
): Promise<UserContext> {
  const startedAt = Date.now();
  const traceSink = options.traceSink ?? noopTraceSink;
  const k = options.k ?? envInt("LINKROWTH_RETRIEVAL_K", DEFAULT_K);
  const minScore =
    options.minScore ?? envFloat("LINKROWTH_RETRIEVAL_MIN_SCORE", DEFAULT_MIN_SCORE);
  const strategy = resolveRetrievalStrategy(options.strategy);
  const candidatePoolSize =
    options.candidatePoolSize ??
    envInt("LINKROWTH_RETRIEVAL_CANDIDATE_POOL", k * DEFAULT_CANDIDATE_POOL_MULTIPLIER);

  const constructed = buildRetrievalQuery(post, {
    tier: options.queryConstruction,
  });
  const query = constructed.situationQuery;
  const params: Record<string, unknown> = {
    k,
    minScore,
    strategy,
    queryConstruction: {
      tier: constructed.tier,
      fallback: constructed.fallback,
      rawLength: constructed.rawLength,
      constructedLength: constructed.constructedLength,
    },
  };
  if (strategy === "split") {
    params.candidatePoolSize = candidatePoolSize;
  }

  /** Emit a trace without ever letting persistence break retrieval. */
  const emit = async (
    outcome: RetrievalOutcome,
    extra: {
      index?: RetrievalIndexMeta | null;
      candidates?: RetrievalTraceHit[];
      injectedProofPoints?: string[];
      embedMs?: number;
      evidenceEmbedMs?: number;
      evidenceQueryText?: string;
    } = {}
  ): Promise<void> => {
    const trace: RetrievalTrace = {
      schemaVersion: RETRIEVAL_TRACE_SCHEMA_VERSION,
      outcome,
      query: {
        text: query,
        headline: constructed.headline || undefined,
        ...(extra.evidenceQueryText ? { evidenceText: extra.evidenceQueryText } : {}),
      },
      index: extra.index ?? null,
      params,
      candidates: extra.candidates ?? [],
      injectedProofPoints: extra.injectedProofPoints ?? [],
      timings: {
        embedMs: extra.embedMs,
        evidenceEmbedMs: extra.evidenceEmbedMs,
        totalMs: Date.now() - startedAt,
      },
    };
    try {
      await traceSink.record(trace);
    } catch (err) {
      console.warn(
        "[retrieveContext] trace sink failed (ignored):",
        err instanceof Error ? err.message : err
      );
    }
  };

  if (!query) {
    await emit("empty_query");
    return baseContext;
  }

  const indexPath = options.indexPath ?? defaultExperienceIndexPath();
  const loadIndex = options.loadIndex ?? defaultLoadIndex;
  const embedQueryFn = options.embedQuery ?? defaultEmbedQuery;

  let index: ExperienceIndex | null;
  try {
    index = loadIndex(indexPath);
  } catch (err) {
    console.warn(
      `[retrieveContext] Failed to load index at ${indexPath}:`,
      err instanceof Error ? err.message : err
    );
    await emit("no_index");
    return baseContext;
  }

  if (!index?.items?.length) {
    await emit("no_index");
    return baseContext;
  }

  const indexMeta = toIndexMeta(index);

  // Only warn about provider drift when using the real embed path (not test doubles).
  if (!options.embedQuery) {
    warnProviderMismatch(index);
  }

  if (warnIncompatibleIndex(index.schemaVersion)) {
    await emit("no_index", { index: indexMeta });
    return baseContext;
  }

  const embedStartedAt = Date.now();
  let queryVector: number[];
  try {
    queryVector = await embedQueryFn(query);
  } catch (err) {
    console.warn(
      "[retrieveContext] embedQuery failed; continuing without retrieved proof points:",
      err instanceof Error ? err.message : err
    );
    await emit("embed_failed", { index: indexMeta, embedMs: Date.now() - embedStartedAt });
    return baseContext;
  }
  const embedMs = Date.now() - embedStartedAt;

  // --- Candidate generation ---
  // single: rank by combined vector (baseline).
  // split:  rank by situation vector only with wider pool.
  const poolSize = strategy === "split" ? Math.max(candidatePoolSize, k) : Math.max(k * 3, k);
  const rawHits: RankedArtifact[] =
    strategy === "split"
      ? rankBySituation(index, queryVector, poolSize)
      : rankIndex(index, queryVector, poolSize);

  // --- Evidence scoring (split strategy, Phase 2) ---
  // Compute evidence cosine for every candidate and annotate the trace.
  // Not used to gate or reorder selection in Phase 2.
  let evidenceEmbedMs: number | undefined;
  let evidenceQueryText: string | undefined;
  let evidenceVectors: Map<string, number> | undefined;

  if (strategy === "split") {
    if (options.analysis) {
      const eq = buildEvidenceQuery(options.analysis);
      evidenceQueryText = eq.evidenceQuery || undefined;

      if (evidenceQueryText) {
        const evidenceEmbedStart = Date.now();
        try {
          const eqVector = await embedQueryFn(evidenceQueryText);
          evidenceEmbedMs = Date.now() - evidenceEmbedStart;
          evidenceVectors = new Map<string, number>();

          // Find the IndexedExperience for each raw hit to compute evidence cosine.
          const itemById = new Map(index.items.map((item) => [item.id, item]));
          for (const hit of rawHits) {
            const item = itemById.get(hit.artifact.id);
            if (item) {
              evidenceVectors.set(hit.artifact.id, computeEvidenceScore(item, eqVector));
            }
          }
        } catch (err) {
          console.warn(
            "[retrieveContext] evidence embedQuery failed (ignored — annotation only):",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }

  // --- Selection (unchanged in Phase 2) ---
  const decisions = evaluateHits(rawHits, { minScore, k });
  const candidates: RetrievalTraceHit[] = decisions.map((decision) => {
    const hit: RetrievalTraceHit = {
      artifactId: decision.hit.artifact.id,
      score: decision.hit.score,
      rank: decision.rank,
      selected: decision.selected,
      dropReason: decision.dropReason,
      claimableLine: decision.hit.artifact.claimableLine,
    };
    if (strategy === "split") {
      hit.situationScore = decision.hit.score;
      if (evidenceVectors) {
        const es = evidenceVectors.get(decision.hit.artifact.id);
        if (es !== undefined) hit.evidenceScore = es;
      }
    }
    return hit;
  });

  const selected = decisions.filter((decision) => decision.selected).map((d) => d.hit);

  if (selected.length === 0) {
    await emit("no_survivors", {
      index: indexMeta,
      candidates,
      embedMs,
      evidenceEmbedMs,
      evidenceQueryText,
    });
    return baseContext;
  }

  const claimableLines = selected.map((hit) => hit.artifact.claimableLine);
  const proofPoints = mergeProofPoints(baseContext.proofPoints, claimableLines);

  await emit("injected", {
    index: indexMeta,
    candidates,
    injectedProofPoints: claimableLines,
    embedMs,
    evidenceEmbedMs,
    evidenceQueryText,
  });

  return {
    ...baseContext,
    proofPoints,
  };
}
