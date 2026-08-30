import { join } from "node:path";
import { getActiveProviderConfig } from "../config/llm";
import { embedQuery as defaultEmbedQuery } from "../llm";
import { getAgentRoot } from "../paths";
import type { Post, UserContext } from "../core/types";
import {
  buildRetrievalQuery,
  type BuildRetrievalQueryOptions,
  type QueryConstructionTier,
  type RetrievalQuery,
} from "./queryConstruction";
import { evaluateHits, mergeProofPoints } from "./experience/select";
import { loadIndex as defaultLoadIndex, rankIndex } from "./experience/store";
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
}

function toIndexMeta(index: ExperienceIndex): RetrievalIndexMeta {
  return {
    provider: index.embedding.provider,
    model: index.embedding.model,
    dimensions: index.embedding.dimensions,
    indexedAt: index.indexedAt,
    count: index.count,
  };
}

const DEFAULT_K = 5;
const DEFAULT_MIN_SCORE = 0.3;

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

/**
 * Enrich UserContext with claimable proof points retrieved from the experience index.
 * Graceful: missing index, empty query, or embed failures return baseContext unchanged.
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
  const constructed = buildRetrievalQuery(post, {
    tier: options.queryConstruction,
  });
  const query = constructed.situationQuery;
  const params: Record<string, unknown> = {
    k,
    minScore,
    queryConstruction: {
      tier: constructed.tier,
      fallback: constructed.fallback,
      rawLength: constructed.rawLength,
      constructedLength: constructed.constructedLength,
    },
  };

  /** Emit a trace without ever letting persistence break retrieval. */
  const emit = async (
    outcome: RetrievalOutcome,
    extra: {
      index?: RetrievalIndexMeta | null;
      candidates?: RetrievalTraceHit[];
      injectedProofPoints?: string[];
      embedMs?: number;
    } = {}
  ): Promise<void> => {
    const trace: RetrievalTrace = {
      schemaVersion: RETRIEVAL_TRACE_SCHEMA_VERSION,
      outcome,
      query: {
        text: query,
        headline: constructed.headline || undefined,
      },
      index: extra.index ?? null,
      params,
      candidates: extra.candidates ?? [],
      injectedProofPoints: extra.injectedProofPoints ?? [],
      timings: { embedMs: extra.embedMs, totalMs: Date.now() - startedAt },
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
  const embedQuery = options.embedQuery ?? defaultEmbedQuery;

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

  const embedStartedAt = Date.now();
  let queryVector: number[];
  try {
    queryVector = await embedQuery(query);
  } catch (err) {
    console.warn(
      "[retrieveContext] embedQuery failed; continuing without retrieved proof points:",
      err instanceof Error ? err.message : err
    );
    await emit("embed_failed", { index: indexMeta, embedMs: Date.now() - embedStartedAt });
    return baseContext;
  }
  const embedMs = Date.now() - embedStartedAt;

  // Over-fetch before filters so k survivors remain after shareability/confidence/score cuts.
  const rawHits: RankedArtifact[] = rankIndex(index, queryVector, Math.max(k * 3, k));
  const decisions = evaluateHits(rawHits, { minScore, k });
  const candidates: RetrievalTraceHit[] = decisions.map((decision) => ({
    artifactId: decision.hit.artifact.id,
    score: decision.hit.score,
    rank: decision.rank,
    selected: decision.selected,
    dropReason: decision.dropReason,
    claimableLine: decision.hit.artifact.claimableLine,
  }));
  const selected = decisions.filter((decision) => decision.selected).map((d) => d.hit);

  if (selected.length === 0) {
    await emit("no_survivors", { index: indexMeta, candidates, embedMs });
    return baseContext;
  }

  const claimableLines = selected.map((hit) => hit.artifact.claimableLine);
  const proofPoints = mergeProofPoints(baseContext.proofPoints, claimableLines);

  await emit("injected", {
    index: indexMeta,
    candidates,
    injectedProofPoints: claimableLines,
    embedMs,
  });

  return {
    ...baseContext,
    proofPoints,
  };
}
