import type { Post, UserContext } from "../../core/types";
import type {
  AnalysisArtifact,
  HumanClarification,
} from "../../steps/types";
import {
  RETRIEVAL_TRACE_SCHEMA_VERSION,
  type RetrievalTrace,
  type RetrievalTraceHit,
} from "../../persistence/retrievalTrace/types";
import { buildEvidenceQuery } from "../queryConstruction";
import {
  candidateIndexPath,
  shortlistMatches,
  type CandidateLoadIndexFn,
  type CandidateShortlist,
} from "../retrievalCandidates";
import { tokenizeFts5Terms } from "./fts";
import { eligibilityDropReason, mergeProofPoints } from "./select";
import {
  evidenceScore,
  loadIndex as defaultLoadIndex,
} from "./store";
import type { FusedCandidate } from "./types";
import { embedQuery as defaultEmbedQuery } from "../../llm";

export type AnalysisAwareFailureReason =
  | "shortlist_not_ready"
  | "stale_shortlist"
  | "missing_index"
  | "empty_evidence_query"
  | "evidence_embed_failed";

export class AnalysisAwareRetrievalError extends Error {
  constructor(
    readonly reason: AnalysisAwareFailureReason,
    message: string
  ) {
    super(message);
    this.name = "AnalysisAwareRetrievalError";
  }
}

export type AnalysisAwareAbstentionReason =
  | "no_generation_match"
  | "no_evidence_match"
  | "no_safe_candidate";

export interface AnalysisAwareSelection {
  context: UserContext;
  trace: RetrievalTrace;
  selectedArtifactIds: string[];
  abstentionReason?: AnalysisAwareAbstentionReason;
}

export interface SelectForAnalysisOptions {
  indexPath?: string;
  loadIndex?: CandidateLoadIndexFn;
  embedQuery?: (text: string) => Promise<number[]>;
  k?: number;
  minSituationScore?: number;
  minEvidenceScore?: number;
}

interface ScoredCandidate {
  candidate: FusedCandidate;
  evidenceScore?: number;
  exactOverlapTerms: string[];
  generationRelevant: boolean;
  dropReason?: RetrievalTraceHit["dropReason"];
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

function intentTerms(
  post: Post,
  analysis: AnalysisArtifact,
  clarification?: HumanClarification
): Set<string> {
  const query = buildEvidenceQuery(analysis, clarification);
  return new Set(
    tokenizeFts5Terms(
      [
        post.text,
        query.evidenceQuery,
        post.author?.headline ?? "",
      ].join("\n"),
      64
    ).map((term) => term.toLocaleLowerCase("en"))
  );
}

function overlapTerms(
  candidate: FusedCandidate,
  intent: Set<string>
): string[] {
  const artifactTerms = tokenizeFts5Terms(
    [
      candidate.artifact.domains.join(" "),
      candidate.artifact.stack.join(" "),
    ].join("\n"),
    64
  );
  return [
    ...new Set(
      artifactTerms
        .map((term) => term.toLocaleLowerCase("en"))
        .filter((term) => intent.has(term))
    ),
  ].sort();
}

export function compareAnalysisAwareCandidates(
  left: Pick<ScoredCandidate, "candidate" | "evidenceScore" | "exactOverlapTerms">,
  right: Pick<ScoredCandidate, "candidate" | "evidenceScore" | "exactOverlapTerms">
): number {
  const leftEvidence =
    left.evidenceScore ?? Number.NEGATIVE_INFINITY;
  const rightEvidence =
    right.evidenceScore ?? Number.NEGATIVE_INFINITY;
  if (leftEvidence !== rightEvidence) return rightEvidence - leftEvidence;

  const overlapDelta =
    right.exactOverlapTerms.length - left.exactOverlapTerms.length;
  if (overlapDelta !== 0) return overlapDelta;

  const rrfDelta = right.candidate.rrfScore - left.candidate.rrfScore;
  if (rrfDelta !== 0) return rrfDelta;
  return left.candidate.artifact.id.localeCompare(right.candidate.artifact.id);
}

/** Rerank a hybrid shortlist with completed analysis, then explicitly accept or abstain. */
export async function selectForAnalysis(
  post: Post,
  analysis: AnalysisArtifact,
  clarification: HumanClarification | undefined,
  shortlist: CandidateShortlist,
  baseContext: UserContext,
  options: SelectForAnalysisOptions = {}
): Promise<AnalysisAwareSelection> {
  const startedAt = Date.now();
  if (shortlist.status !== "ready") {
    throw new AnalysisAwareRetrievalError(
      "shortlist_not_ready",
      `candidate shortlist status is ${shortlist.status}`
    );
  }

  const loadIndex = options.loadIndex ?? defaultLoadIndex;
  const path = options.indexPath ?? candidateIndexPath();
  const index = loadIndex(path);
  if (!index) {
    throw new AnalysisAwareRetrievalError(
      "missing_index",
      "experience index is unavailable during analysis-aware selection"
    );
  }
  if (!shortlistMatches(shortlist, post, index)) {
    throw new AnalysisAwareRetrievalError(
      "stale_shortlist",
      "post or index fingerprint changed after candidate generation"
    );
  }

  const evidence = buildEvidenceQuery(analysis, clarification);
  if (!evidence.evidenceQuery) {
    throw new AnalysisAwareRetrievalError(
      "empty_evidence_query",
      "analysis did not produce evidence-ranking intent"
    );
  }

  const embed = options.embedQuery ?? defaultEmbedQuery;
  const evidenceEmbedStartedAt = Date.now();
  let evidenceVector: number[];
  try {
    evidenceVector = await embed(evidence.evidenceQuery);
  } catch (error) {
    throw new AnalysisAwareRetrievalError(
      "evidence_embed_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
  const evidenceEmbedMs = Date.now() - evidenceEmbedStartedAt;

  const k = options.k ?? envInt("LINKROWTH_RETRIEVAL_K", 5);
  const minSituationScore =
    options.minSituationScore ??
    (typeof shortlist.params.minScore === "number"
      ? shortlist.params.minScore
      : envFloat("LINKROWTH_RETRIEVAL_MIN_SCORE", 0.3));
  const minEvidenceScore =
    options.minEvidenceScore ??
    envFloat("LINKROWTH_RETRIEVAL_EVIDENCE_MIN_SCORE", 0.3);
  const itemById = new Map(index.items.map((item) => [item.id, item]));
  const intent = intentTerms(post, analysis, clarification);

  const scored: ScoredCandidate[] = shortlist.candidates.map((candidate) => {
    const item = itemById.get(candidate.artifact.id);
    const hardDrop = eligibilityDropReason(candidate.artifact);
    const generationRelevant =
      candidate.lexicalRank !== undefined ||
      (candidate.situationScore !== undefined &&
        candidate.situationScore >= minSituationScore);
    const score = item ? evidenceScore(item, evidenceVector) : undefined;
    let dropReason: RetrievalTraceHit["dropReason"];
    if (hardDrop) dropReason = hardDrop;
    else if (!item) dropReason = "missing_index_item";
    else if (!generationRelevant) dropReason = "generation_relevance";
    else if (score === undefined || score < minEvidenceScore) {
      dropReason = "evidence_score";
    }
    return {
      candidate,
      evidenceScore: score,
      exactOverlapTerms: overlapTerms(candidate, intent),
      generationRelevant,
      dropReason,
    };
  });

  const ordered = [...scored].sort(compareAnalysisAwareCandidates);
  const selectedArtifactIds: string[] = [];
  const selectedLines: string[] = [];
  const seenLines = new Set<string>();
  const hits: RetrievalTraceHit[] = ordered.map((entry, rank) => {
    let dropReason = entry.dropReason;
    const line = entry.candidate.artifact.claimableLine.trim();
    const lineKey = line.toLocaleLowerCase("en");
    if (!dropReason && seenLines.has(lineKey)) dropReason = "duplicate_claim";
    if (!dropReason && selectedLines.length >= k) dropReason = "over_k";

    const selected = dropReason === undefined;
    if (selected) {
      seenLines.add(lineKey);
      selectedLines.push(line);
      selectedArtifactIds.push(entry.candidate.artifact.id);
    }

    return {
      artifactId: entry.candidate.artifact.id,
      score: entry.evidenceScore ?? -1,
      rank,
      selected,
      dropReason,
      claimableLine: entry.candidate.artifact.claimableLine,
      semanticRank: entry.candidate.semanticRank,
      lexicalRank: entry.candidate.lexicalRank,
      situationScore: entry.candidate.situationScore,
      evidenceScore: entry.evidenceScore,
      bm25Score: entry.candidate.bm25Score,
      rrfScore: entry.candidate.rrfScore,
      signals: {
        generationRelevant: entry.generationRelevant,
        minSituationScore,
        minEvidenceScore,
        exactOverlapTerms: entry.exactOverlapTerms,
        exactOverlapCount: entry.exactOverlapTerms.length,
        evidenceQueryFields: evidence.provenance,
      },
    };
  });
  hits.push(...shortlist.prefilteredCandidates);

  let abstentionReason: AnalysisAwareAbstentionReason | undefined;
  if (selectedLines.length === 0) {
    if (!scored.some((entry) => entry.generationRelevant)) {
      abstentionReason = "no_generation_match";
    } else if (
      !scored.some(
        (entry) =>
          entry.generationRelevant &&
          entry.evidenceScore !== undefined &&
          entry.evidenceScore >= minEvidenceScore
      )
    ) {
      abstentionReason = "no_evidence_match";
    } else {
      abstentionReason = "no_safe_candidate";
    }
  }

  const rerankMs = Date.now() - startedAt;
  const trace: RetrievalTrace = {
    schemaVersion: RETRIEVAL_TRACE_SCHEMA_VERSION,
    outcome: abstentionReason ? "abstained" : "injected",
    query: {
      text: shortlist.query.situationQuery,
      headline: shortlist.query.headline || undefined,
      evidenceText: evidence.evidenceQuery,
    },
    index: shortlist.index,
    params: {
      ...shortlist.params,
      pipeline: "analysis_aware",
      shortlistVersion: shortlist.version,
      postFingerprint: shortlist.postFingerprint,
      minSituationScore,
      minEvidenceScore,
      ordering:
        "evidence_score,exact_overlap_count,rrf_score,artifact_id",
      evidenceQueryProvenance: evidence.provenance,
      intentProvenance: {
        postBody: true,
        authorHeadline: Boolean(shortlist.query.headline),
        analysis: true,
        clarification:
          clarification?.status === "answered" && clarification.answer.trim()
            ? "answered"
            : "none",
      },
      ...(abstentionReason ? { abstentionReason } : {}),
    },
    candidates: hits,
    injectedProofPoints: selectedLines,
    timings: {
      embedMs: shortlist.timings.situationEmbedMs,
      evidenceEmbedMs,
      lexicalMs: shortlist.timings.lexicalMs,
      candidateGenerationMs: shortlist.timings.candidateGenerationMs,
      rerankMs,
      totalMs:
        shortlist.timings.candidateGenerationMs + rerankMs,
    },
  };

  return {
    context: selectedLines.length
      ? {
          ...baseContext,
          proofPoints: mergeProofPoints(
            baseContext.proofPoints,
            selectedLines
          ),
        }
      : baseContext,
    trace,
    selectedArtifactIds,
    abstentionReason,
  };
}
