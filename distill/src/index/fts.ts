/** Sanitize text for FTS5 MATCH — strip operators that break or hijack the query. */
export function buildFts5Query(text: string): string {
  return text
    .replace(/["^*()[\]{}:]/g, " ")
    .replace(/\b(OR|AND|NOT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
