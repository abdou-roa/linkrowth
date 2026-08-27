export function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}

export function roundVector(vector: number[], digits = 6): number[] {
  const f = 10 ** digits;
  return vector.map((n) => Math.round(n * f) / f);
}
