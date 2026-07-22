import type { EngageResult } from "./types";

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
