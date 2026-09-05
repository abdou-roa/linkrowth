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

/** Keep in sync with agent/src/context/experience/fts.ts. */
export function normalizeTechnicalTerms(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\bc\+\+(?=\W|$)/gi, "cplusplus")
    .replace(/\bc#(?=\W|$)/gi, "csharp")
    .replace(/\bnode\.?js\b/gi, "nodejs")
    .replace(/(^|\s)\.net\b/gi, "$1dotnet");
}

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

/** Build a parser-safe, bounded OR query from natural post text. */
export function buildFts5Query(text: string, maxTerms = DEFAULT_MAX_FTS5_TERMS): string {
  return tokenizeFts5Terms(text, maxTerms).map(quoteFts5Term).join(" OR ");
}
