import type { LlmRequest } from "../llm/types";
import { loadCodeDiff, needsCodeDiff } from "./diff";
import { buildDistillPrompt } from "./prompt";
import { parseDistillResponse, type DistillOutcome } from "./parse";
import type { DistillDropRecord, RawExperienceCandidate } from "../types";

type LlmCall = (request: LlmRequest) => Promise<string>;
export type LoadDiff = (candidate: RawExperienceCandidate) => Promise<string | null>;

function dropFromError(
  candidate: RawExperienceCandidate,
  rule: string,
  err: unknown
): DistillDropRecord {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    id: candidate.id,
    rule,
    title: candidate.title,
    source: candidate.source,
    repo: candidate.repo,
    detail: detail.slice(0, 400),
  };
}

function isParseError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /json/i.test(message);
}

export async function distillOne(
  candidate: RawExperienceCandidate,
  call: LlmCall,
  loadDiff: LoadDiff = loadCodeDiff
): Promise<DistillOutcome> {
  const diff = needsCodeDiff(candidate) ? await loadDiff(candidate) : null;
  const prompt = buildDistillPrompt(candidate, { diff });
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await call({
        ...prompt,
        json: true,
        maxTokens: 800,
        user:
          attempt === 0
            ? prompt.user
            : `${prompt.user}\n\nYour previous reply was not valid JSON matching the schema. Return only the JSON object.`,
      });
      return parseDistillResponse(raw, candidate);
    } catch (err) {
      lastError = err;
    }
  }

  const rule = isParseError(lastError) ? "D_parse" : "D_call";
  return { kind: "drop", drop: dropFromError(candidate, rule, lastError) };
}
