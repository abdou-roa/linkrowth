import { ToneEvalResult } from "../types"
import { ToneJudgeInput } from "../types"
import {call} from "../../src/llm"

export async function runToneJudge(input: ToneJudgeInput): Promise<ToneEvalResult>
{
  const hasVoiceSamples = input.voiceSamples.length > 0;
  const avoidSection = input.avoid?.length
    ? `\nAUTHOR FORBIDDEN PATTERNS (from generation guardrails):\n${input.avoid.map((item) => `- ${item}`).join("\n")}`
    : "";

  const toneJudgePrompt = `You are a calibrated style-consistency evaluator for LinkedIn comments.
Your job is to check whether a generated comment reasonably matches the author's voice profile — not whether it is literary perfection.

## CALIBRATION RULES (read first — apply to every assertion)
1. Default each assertion to TRUE unless there is a clear, specific violation.
2. When borderline or ambiguous, choose TRUE. You are measuring gross misalignment, not nitpicks.
3. Evaluate each assertion independently. One weakness must not cascade into failing unrelated assertions.
4. Short professional comments naturally vary in rhythm; allow reasonable variance from samples.
5. If voice samples are empty, judge only against the explicit voice notes — do not invent stricter standards.

## ASSERTION RUBRICS

### lengthAndLineBounds
TRUE when the comment respects the sentence/length guidance in the voice notes (typically 2–4 sentences).
FALSE only when it clearly ignores stated bounds (e.g., voice notes say 2–4 sentences but the comment is 6+ sentences or one bloated paragraph).

### matchesPacingAndComplexity
TRUE when sentence length and complexity are in the same ballpark as the voice profile — direct if notes say direct, measured if samples are measured.
${hasVoiceSamples
    ? "Use the reference samples as a rhythm guide, not a template to copy."
    : "No voice samples provided — pass if the comment plausibly fits the voice notes."}
FALSE only when the comment is obviously mismatched (e.g., notes/samples are terse and plain but the comment is ornate and essay-like).

### retainsGrit
TRUE when the comment sounds like a real practitioner — not a polished marketing blurb or generic LinkedIn influencer voice.
FALSE only when it is clearly over-smoothed, buzzword-heavy, or reads like corporate PR despite the profile calling for directness.

### organicTransitions
TRUE when phrasing flows naturally; light connectors ("and", "but", "so") are fine.
FALSE only when it leans on stiff formal transitions ("Moreover," "Furthermore," "In conclusion," "It is worth noting that") that clash with the voice profile.

## OUTPUT
Return raw JSON only — no markdown fences:
{
  "assertions": {
    "lengthAndLineBounds": true,
    "matchesPacingAndComplexity": true,
    "retainsGrit": true,
    "organicTransitions": true
  },
  "reasoning": "One sentence per assertion: state the evidence, then pass/fail."
}`;

  const userPrompt = `TARGET AUTHOR VOICE PARAMETERS:
- Voice Notes: "${input.voiceNotes}"
${hasVoiceSamples
    ? `- Reference Voice Samples:\n${input.voiceSamples.map((sample, index) => `  ${index + 1}. "${sample}"`).join("\n")}`
    : "- Reference Voice Samples: (none — rely on voice notes only)"}${avoidSection}

GENERATED COMMENT TO EVALUATE:
"${input.generatedComment}"`;

  const request = {
    system: toneJudgePrompt,
    user: userPrompt,
  };

  try{
    const resp = await call(request, true);
    const judgeResult: ToneEvalResult = JSON.parse(resp);
    return judgeResult;
  }catch (error) {
    console.error("Error running tone judge:", error);
    throw error;
  }
}
