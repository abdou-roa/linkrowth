import { createHash } from "node:crypto";
import { join } from "node:path";
import { getAgentRoot } from "../paths";
import type { Post } from "../core/types";
import type {
  RetrievalIndexMeta,
  RetrievalTraceHit,
} from "../persistence/retrievalTrace/types";
import { buildRetrievalQuery, type RetrievalQuery } from "./queryConstruction";
import {
  buildFts5Query,
  DEFAULT_BM25_WEIGHTS,
  LexicalSearchError,
  loadIndex as defaultLoadIndex,
  rankByLexical,
  rankBySituation,
  fuseRRF,
} from "./experience/store";
import type {
  ExperienceIndex,
  FusedCandidate,
  LexicalRankedArtifact,
  RankedArtifact,
} from "./experience/types";
import type {
  CandidateWindow,
  CandidateWindowEntry,
} from "./experience/select";
import { embedQuery as defaultEmbedQuery } from "../llm";

export const CANDIDATE_SHORTLIST_VERSION = 1;

export type CandidateGenerationStatus =
  | "ready"
  | "empty_query"
  | "no_index"
  | "embed_failed";

export interface CandidateShortlist {
  version: typeof CANDIDATE_SHORTLIST_VERSION;
  status: CandidateGenerationStatus;
  postFingerprint: string;
  query: RetrievalQuery;
  index: RetrievalIndexMeta | null;
  candidates: FusedCandidate[];
  prefilteredCandidates: RetrievalTraceHit[];
  params: Record<string, unknown>;
  timings: {
    candidateGenerationMs: number;
    situationEmbedMs?: number;
    lexicalMs?: number;
  };
  failureReason?: string;
}

export function isCandidateShortlist(value: unknown): value is CandidateShortlist {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CandidateShortlist>;
  return (
    candidate.version === CANDIDATE_SHORTLIST_VERSION &&
    typeof candidate.status === "string" &&
    typeof candidate.postFingerprint === "string" &&
    Boolean(candidate.query) &&
    Array.isArray(candidate.candidates) &&
    Array.isArray(candidate.prefilteredCandidates) &&
    Boolean(candidate.params) &&
    Boolean(candidate.timings)
  );
}

export type CandidateEmbedQueryFn = (text: string) => Promise<number[]>;
export type CandidateLoadIndexFn = (dbPath: string) => ExperienceIndex | null;
export type CandidateLexicalSearchFn = (
  dbPath: string,
  query: string,
  k: number
) => CandidateWindow<LexicalRankedArtifact>;

export interface GenerateCandidatesOptions {
  indexPath?: string;
  embedQuery?: CandidateEmbedQueryFn;
  loadIndex?: CandidateLoadIndexFn;
  lexicalSearch?: CandidateLexicalSearchFn;
  candidatePoolSize?: number;
  lexicalPoolSize?: number;
  minScore?: number;
  rrfC?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function candidateIndexPath(): string {
  return (
    process.env.LINKROWTH_EXPERIENCE_INDEX_DB?.trim() ||
    join(getAgentRoot(), "..", "distill", "data", "experience-index.db")
  );
}

export function fingerprintPost(post: Post): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: post.id ?? null,
        text: post.text,
        headline: post.author?.headline ?? null,
      })
    )
    .digest("hex");
}

export function indexFingerprint(index: ExperienceIndex): RetrievalIndexMeta {
  return {
    provider: index.embedding.provider,
    model: index.embedding.model,
    dimensions: index.embedding.dimensions,
    indexedAt: index.indexedAt,
    count: index.count,
    schemaVersion: index.schemaVersion,
  };
}

export function shortlistMatches(
  shortlist: CandidateShortlist,
  post: Post,
  index: ExperienceIndex
): boolean {
  const expected = indexFingerprint(index);
  return (
    shortlist.version === CANDIDATE_SHORTLIST_VERSION &&
    shortlist.postFingerprint === fingerprintPost(post) &&
    shortlist.index?.provider === expected.provider &&
    shortlist.index.model === expected.model &&
    shortlist.index.dimensions === expected.dimensions &&
    shortlist.index.indexedAt === expected.indexedAt &&
    shortlist.index.count === expected.count &&
    shortlist.index.schemaVersion === expected.schemaVersion
  );
}

function prefilteredWitnesses(
  semanticEntries: Array<CandidateWindowEntry<RankedArtifact>>,
  lexicalEntries: Array<CandidateWindowEntry<LexicalRankedArtifact>>
): RetrievalTraceHit[] {
  const byId = new Map<string, RetrievalTraceHit>();

  for (const entry of semanticEntries) {
    if (!entry.dropReason) continue;
    byId.set(entry.candidate.artifact.id, {
      artifactId: entry.candidate.artifact.id,
      score: entry.candidate.score,
      rank: entry.rank,
      semanticRank: entry.rank + 1,
      situationScore: entry.candidate.score,
      selected: false,
      dropReason: entry.dropReason,
      claimableLine: entry.candidate.artifact.claimableLine,
      prefiltered: true,
    });
  }

  for (const entry of lexicalEntries) {
    if (!entry.dropReason) continue;
    const existing = byId.get(entry.candidate.artifact.id);
    if (existing) {
      existing.lexicalRank = entry.rank + 1;
      existing.bm25Score = entry.candidate.bm25Score;
      continue;
    }
    byId.set(entry.candidate.artifact.id, {
      artifactId: entry.candidate.artifact.id,
      score: entry.candidate.bm25Score,
      rank: entry.rank,
      lexicalRank: entry.rank + 1,
      bm25Score: entry.candidate.bm25Score,
      selected: false,
      dropReason: entry.dropReason,
      claimableLine: entry.candidate.artifact.claimableLine,
      prefiltered: true,
    });
  }

  return [...byId.values()];
}

function emptyShortlist(
  post: Post,
  query: RetrievalQuery,
  status: Exclude<CandidateGenerationStatus, "ready">,
  startedAt: number,
  params: Record<string, unknown>,
  extra: {
    index?: RetrievalIndexMeta | null;
    situationEmbedMs?: number;
    failureReason?: string;
  } = {}
): CandidateShortlist {
  return {
    version: CANDIDATE_SHORTLIST_VERSION,
    status,
    postFingerprint: fingerprintPost(post),
    query,
    index: extra.index ?? null,
    candidates: [],
    prefilteredCandidates: [],
    params,
    timings: {
      candidateGenerationMs: Date.now() - startedAt,
      situationEmbedMs: extra.situationEmbedMs,
    },
    failureReason: extra.failureReason,
  };
}

/** Generate a broad hybrid shortlist without selecting or injecting proof points. */
export async function generateCandidates(
  post: Post,
  options: GenerateCandidatesOptions = {}
): Promise<CandidateShortlist> {
  const startedAt = Date.now();
  const candidatePoolSize =
    options.candidatePoolSize ??
    envInt("LINKROWTH_RETRIEVAL_CANDIDATE_POOL", 20);
  const lexicalPoolSize =
    options.lexicalPoolSize ??
    envInt("LINKROWTH_RETRIEVAL_LEXICAL_POOL", 20);
  const minScore =
    options.minScore ??
    envFloat("LINKROWTH_RETRIEVAL_MIN_SCORE", 0.3);
  const rrfC =
    options.rrfC ??
    envInt("LINKROWTH_RETRIEVAL_RRF_C", 60);
  const query = buildRetrievalQuery(post);
  const params: Record<string, unknown> = {
    strategy: "hybrid",
    candidatePoolSize,
    lexicalPoolSize,
    minScore,
    rrfC,
    bm25Weights: DEFAULT_BM25_WEIGHTS,
  };

  if (!query.situationQuery) {
    return emptyShortlist(post, query, "empty_query", startedAt, params);
  }

  const path = options.indexPath ?? candidateIndexPath();
  const loadIndex = options.loadIndex ?? defaultLoadIndex;
  let index: ExperienceIndex | null;
  try {
    index = loadIndex(path);
  } catch (error) {
    return emptyShortlist(post, query, "no_index", startedAt, params, {
      failureReason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!index?.items.length) {
    return emptyShortlist(post, query, "no_index", startedAt, params, {
      failureReason: "missing_or_empty_index",
    });
  }

  const meta = indexFingerprint(index);
  const embed = options.embedQuery ?? defaultEmbedQuery;
  const embedStartedAt = Date.now();
  let queryVector: number[];
  try {
    queryVector = await embed(query.situationQuery);
  } catch (error) {
    return emptyShortlist(post, query, "embed_failed", startedAt, params, {
      index: meta,
      situationEmbedMs: Date.now() - embedStartedAt,
      failureReason: error instanceof Error ? error.message : String(error),
    });
  }
  const situationEmbedMs = Date.now() - embedStartedAt;
  const semanticWindow = rankBySituation(index, queryVector, candidatePoolSize);

  let lexicalWindow: CandidateWindow<LexicalRankedArtifact> = {
    eligible: [],
    entries: [],
  };
  let lexicalMs: number | undefined;
  const fts5Query = buildFts5Query(query.situationQuery);
  if (fts5Query) {
    const lexicalStartedAt = Date.now();
    try {
      const lexicalSearch = options.lexicalSearch ?? rankByLexical;
      lexicalWindow = lexicalSearch(path, fts5Query, lexicalPoolSize);
      lexicalMs = Date.now() - lexicalStartedAt;
      params.lexicalChannel = {
        status: "ok",
        query: fts5Query,
        hitCount: lexicalWindow.eligible.length,
        examinedCount: lexicalWindow.entries.length,
      };
    } catch (error) {
      lexicalMs = Date.now() - lexicalStartedAt;
      params.lexicalChannel = {
        status: "failed",
        query: fts5Query,
        reason:
          error instanceof LexicalSearchError ? error.reason : "fts_error",
        fallback: "situation_only",
      };
    }
  } else {
    params.lexicalChannel = {
      status: "skipped",
      reason: "empty_query",
      fallback: "situation_only",
    };
  }

  const candidates = fuseRRF(
    semanticWindow.eligible,
    lexicalWindow.eligible,
    { c: rrfC }
  );

  return {
    version: CANDIDATE_SHORTLIST_VERSION,
    status: "ready",
    postFingerprint: fingerprintPost(post),
    query,
    index: meta,
    candidates,
    prefilteredCandidates: prefilteredWitnesses(
      semanticWindow.entries,
      lexicalWindow.entries
    ),
    params,
    timings: {
      candidateGenerationMs: Date.now() - startedAt,
      situationEmbedMs,
      lexicalMs,
    },
  };
}
