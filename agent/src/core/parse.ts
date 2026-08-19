import type { EngageResult } from "./types";

/** Pull a JSON object out of a model response that may be fenced or prefaced. */
export function extractJsonBlock(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }

  return raw.trim();
}

/**
 * Repair common LLM JSON mistakes that break JSON.parse, without changing
 * string contents (trailing commas only outside quotes).
 */
export function repairJson(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    // Drop trailing commas before } or ]
    if (ch === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j]!)) j++;
      const next = json[j];
      if (next === "}" || next === "]") {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/** extractJsonBlock + trailing-comma repair, then JSON.parse. */
export function parseJsonBlock<T = unknown>(raw: string): T {
  const block = extractJsonBlock(raw);
  try {
    return JSON.parse(block) as T;
  } catch (first) {
    try {
      return JSON.parse(repairJson(block)) as T;
    } catch {
      throw first instanceof Error
        ? first
        : new Error(`Failed to parse JSON block: ${String(first)}`);
    }
  }
}

export function parseEngageResponse(text: string): EngageResult {
  const cleanedText = text
    .replace(/^```(?:markdown)?\n/i, "")
    .replace(/\n```$/, "")
    .trim();

  const categoryMatch = cleanedText.match(/\*\*Category:\*\*\s*([^\n]+)/i);

  const coreSubjectMatch = cleanedText.match(/\*\*Core Subject:\*\*\s*([^\n]+)/i);

  const appliedPlaybookMatch = cleanedText.match(/\*\*Applied Playbook:\*\*\s*([^\n]+)/i);

  const valueHookMatch = cleanedText.match(/\*\*Value Hook:\*\*\s*([^\n]+)/i);

  const voiceCheckMatch = cleanedText.match(/\*\*Voice Check:\*\*\s*([^\n]+)/i);

  const suggestionMatch = cleanedText.match(
    /\*\*Suggestion:\*\*\s*\n?([\s\S]*?)(?=\n+\*\*Why:\*\*)/i
  );

  const rationaleMatch = cleanedText.match(
    /\*\*Why:\*\*\s*\n?([\s\S]+)$/i
  );

  if (!suggestionMatch || !rationaleMatch) {
    throw new Error(
      "Could not parse LLM response — missing the required **Suggestion:** or **Why:** markers."
    );
  }

  return {
    category: categoryMatch?.[1]?.trim(),
    coreSubject: coreSubjectMatch?.[1]?.trim(),
    appliedPlaybook: appliedPlaybookMatch?.[1]?.trim(),
    valueHook: valueHookMatch?.[1]?.trim(),
    voiceCheck: voiceCheckMatch?.[1]?.trim(),
    suggestion: suggestionMatch[1].trim(),
    rationale: rationaleMatch[1].trim(),
  };
}
