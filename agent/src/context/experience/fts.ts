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

const DEFAULT_MAX_FTS5_TERMS = 12;
const FTS5_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "can",
  "do",
  "for",
  "how",
  "in",
  "is",
  "not",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "why",
  "with",
  "without",
  "you",
]);

/** Canonicalize technology names whose punctuation unicode61 does not preserve. */
export function normalizeTechnicalTerms(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\bc\+\+(?=\W|$)/gi, "cplusplus")
    .replace(/\bc#(?=\W|$)/gi, "csharp")
    .replace(/\bnode\.?js\b/gi, "nodejs")
    .replace(/(^|\s)\.net\b/gi, "$1dotnet");
}

/** Extract a deterministic, bounded set of meaningful MATCH terms. */
export function tokenizeFts5Terms(text: string, maxTerms = DEFAULT_MAX_FTS5_TERMS): string[] {
  if (maxTerms <= 0) return [];
  const tokens =
    normalizeTechnicalTerms(text).match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const raw of tokens) {
    const term = raw.replace(/^[._+-]+|[._+-]+$/g, "");
    const key = term.toLocaleLowerCase("en");
    if (!term || FTS5_STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

function quoteFts5Term(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Build a parser-safe, high-recall FTS5 MATCH expression from natural text.
 * Quoted atoms prevent operator injection; OR avoids requiring a short
 * experience artifact to contain every meaningful term from a full post.
 */
export function buildFts5Query(text: string, maxTerms = DEFAULT_MAX_FTS5_TERMS): string {
  return tokenizeFts5Terms(text, maxTerms).map(quoteFts5Term).join(" OR ");
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
