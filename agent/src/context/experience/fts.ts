import type { FusedCandidate, LexicalRankedArtifact, RankedArtifact } from "./types";

/** Per-column BM25 weights for FTS5 search. Recorded in retrieval traces. */
export interface Bm25Weights {
  title: number;
  domains: number;
  stack: number;
  problem: number;
  approach: number;
  paths: number;
}

export const DEFAULT_BM25_WEIGHTS: Bm25Weights = {
  title: 3.0,
  domains: 2.0,
  stack: 2.0,
  problem: 2.0,
  approach: 1.5,
  paths: 0.5,
};

/** Sanitize text for FTS5 MATCH — strip operators that break or hijack the query. */
export function buildFts5Query(text: string): string {
  return text
    .replace(/["^*()[\]{}:]/g, " ")
    .replace(/\b(OR|AND|NOT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reciprocal Rank Fusion — combines semantic and lexical rank lists by position,
 * not raw scores. Candidates in only one list still contribute their channel term.
 */
export function fuseRRF(
  semanticHits: RankedArtifact[],
  lexicalHits: LexicalRankedArtifact[],
  options: { c: number }
): FusedCandidate[] {
  const { c } = options;
  const byId = new Map<string, FusedCandidate>();

  semanticHits.forEach((hit, index) => {
    const rank = index + 1;
    const id = hit.artifact.id;
    const existing = byId.get(id);
    const term = 1 / (c + rank);
    if (existing) {
      existing.semanticRank = rank;
      existing.situationScore = hit.score;
      existing.rrfScore += term;
    } else {
      byId.set(id, {
        artifact: hit.artifact,
        rrfScore: term,
        semanticRank: rank,
        situationScore: hit.score,
      });
    }
  });

  lexicalHits.forEach((hit, index) => {
    const rank = index + 1;
    const id = hit.artifact.id;
    const existing = byId.get(id);
    const term = 1 / (c + rank);
    if (existing) {
      existing.lexicalRank = rank;
      existing.bm25Score = hit.bm25Score;
      existing.rrfScore += term;
    } else {
      byId.set(id, {
        artifact: hit.artifact,
        rrfScore: term,
        lexicalRank: rank,
        bm25Score: hit.bm25Score,
      });
    }
  });

  return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}
