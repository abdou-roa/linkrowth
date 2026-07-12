export interface JudgeResponse<TKey extends string> {
  assertions: Record<TKey, boolean>;
  reasoning: string;
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
}

function preview(raw: string, max = 300): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/**
 * Parses and validates a judge's raw LLM response.
 *
 * The prompts ask for raw JSON, but we can't trust that contract, so this:
 *   1. strips accidental markdown fences,
 *   2. parses the JSON,
 *   3. asserts every expected assertion key is present and is a real boolean,
 *   4. asserts `reasoning` is a string.
 *
 * Throws a descriptive error (including a response preview) on any violation so
 * malformed judge output surfaces loudly instead of silently distorting scores.
 */
export function parseJudgeResponse<TKey extends string>(
  raw: string,
  assertionKeys: readonly TKey[],
  judgeName: string
): JudgeResponse<TKey> {
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${judgeName}: response was not valid JSON. Received: "${preview(raw)}"`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${judgeName}: expected a JSON object, got ${typeof parsed}.`);
  }

  const record = parsed as Record<string, unknown>;
  const assertionsValue = record.assertions;

  if (typeof assertionsValue !== "object" || assertionsValue === null) {
    throw new Error(`${judgeName}: missing or invalid "assertions" object.`);
  }

  const rawAssertions = assertionsValue as Record<string, unknown>;
  const assertions = {} as Record<TKey, boolean>;
  const problems: string[] = [];

  for (const key of assertionKeys) {
    const value = rawAssertions[key];
    if (typeof value !== "boolean") {
      problems.push(
        value === undefined ? `missing "${key}"` : `"${key}" must be a boolean (got ${typeof value})`
      );
      continue;
    }
    assertions[key] = value;
  }

  const extraKeys = Object.keys(rawAssertions).filter(
    (key) => !assertionKeys.includes(key as TKey)
  );
  if (extraKeys.length > 0) {
    problems.push(`unexpected assertion key(s): ${extraKeys.join(", ")}`);
  }

  if (typeof record.reasoning !== "string") {
    problems.push(`"reasoning" must be a string (got ${typeof record.reasoning})`);
  }

  if (problems.length > 0) {
    throw new Error(`${judgeName}: invalid schema — ${problems.join("; ")}.`);
  }

  return { assertions, reasoning: record.reasoning as string };
}
