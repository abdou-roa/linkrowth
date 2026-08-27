import { join } from "node:path";
import { getActiveProviderConfig } from "../config/llm";
import { embedQuery as defaultEmbedQuery } from "../llm";
import { getAgentRoot } from "../paths";
import type { Post, UserContext } from "../core/types";
import { mergeProofPoints, selectClaimableHits } from "./experience/select";
import { loadIndex as defaultLoadIndex, rankIndex } from "./experience/store";
import type { ExperienceIndex, RankedArtifact } from "./experience/types";

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

/** Query text for phase-1 retrieval: author headline (if any) + post body. */
export function buildRetrievalQuery(post: Post): string {
  const headline = post.author?.headline?.trim();
  const body = post.text.trim();
  if (headline && body) return `Author headline: ${headline}\n\n${body}`;
  return body || headline || "";
}

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
  const query = buildRetrievalQuery(post);
  if (!query) return baseContext;

  const indexPath = options.indexPath ?? defaultExperienceIndexPath();
  const loadIndex = options.loadIndex ?? defaultLoadIndex;
  const embedQuery = options.embedQuery ?? defaultEmbedQuery;
  const k = options.k ?? envInt("LINKROWTH_RETRIEVAL_K", DEFAULT_K);
  const minScore =
    options.minScore ?? envFloat("LINKROWTH_RETRIEVAL_MIN_SCORE", DEFAULT_MIN_SCORE);

  let index: ExperienceIndex | null;
  try {
    index = loadIndex(indexPath);
  } catch (err) {
    console.warn(
      `[retrieveContext] Failed to load index at ${indexPath}:`,
      err instanceof Error ? err.message : err
    );
    return baseContext;
  }

  if (!index?.items?.length) {
    return baseContext;
  }

  // Only warn about provider drift when using the real embed path (not test doubles).
  if (!options.embedQuery) {
    warnProviderMismatch(index);
  }

  let queryVector: number[];
  try {
    queryVector = await embedQuery(query);
  } catch (err) {
    console.warn(
      "[retrieveContext] embedQuery failed; continuing without retrieved proof points:",
      err instanceof Error ? err.message : err
    );
    return baseContext;
  }

  // Over-fetch before filters so k survivors remain after shareability/confidence/score cuts.
  const rawHits: RankedArtifact[] = rankIndex(index, queryVector, Math.max(k * 3, k));
  const selected = selectClaimableHits(rawHits, { minScore, k });
  if (selected.length === 0) return baseContext;

  const claimableLines = selected.map((hit) => hit.artifact.claimableLine);
  const proofPoints = mergeProofPoints(baseContext.proofPoints, claimableLines);

  return {
    ...baseContext,
    proofPoints,
  };
}
