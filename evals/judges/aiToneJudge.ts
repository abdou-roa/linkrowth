import { AiToneEvalResult } from "../types"
import { ToneJudgeInput } from "../types"
import {call} from "../../src/llm"
import { parseJudgeResponse } from "./parseJudgeResponse"

const AI_TONE_ASSERTION_KEYS = [
  "avoidedSycophancy",
  "cleanVocabulary",
  "restrainedFormatting",
  "addsValueWithoutParroting",
] as const;

export async function runAiToneJudge(input: ToneJudgeInput): Promise<AiToneEvalResult>
{
    const avoidSection = input.avoid?.length
        ? `\nAUTHOR-SPECIFIC FORBIDDEN PATTERNS:\n${input.avoid.map((item) => `- ${item}`).join("\n")}`
        : "";

    const judgeSystemPrompt = `You are a calibrated QA evaluator checking LinkedIn comments for obvious "AI cringe" — not for literary polish.
Your rubric mirrors the generation system's anti-AI guardrails. Measure clear robotic tells, not subjective taste.

## CALIBRATION RULES (read first — apply to every assertion)
1. Default each assertion to TRUE unless a violation is obvious and unambiguous.
2. When borderline, choose TRUE. Peer-level professional tone should pass.
3. Evaluate each assertion independently.
4. Normal acknowledgment of a post's topic is NOT sycophancy and NOT parroting.
5. One minor imperfection does not fail an assertion — only a clear pattern does.

## ASSERTION RUBRICS

### avoidedSycophancy
TRUE when the comment does NOT open with hollow praise or generic enthusiasm.
Compare against the ORIGINAL POST: brief, specific acknowledgment of the post's actual point is fine; empty praise is not.
Acceptable: entering at peer level with a substantive point, even if briefly acknowledging context ("Shipping that lean is the hard part").
FAIL only on clear violations such as: "Insightful share!", "Great breakdown!", "I completely agree!", "Spot on!", "Couldn't agree more!", or congratulations-style openers with no substance.

### cleanVocabulary
TRUE when the comment avoids obvious AI-anchor words and phrases.
Flag only high-confidence AI tells: "delve", "testament", "tapestry", "foster" (as verb), "moreover", "in today's fast-paced world", "it's important to note", "game-changer", "landscape" (when buzzwordy).
Do NOT fail for ordinary professional vocabulary (e.g., "trade-off", "architecture", "adoption", "constraint").

### restrainedFormatting
TRUE when formatting is restrained — no hype spam.
FAIL only on clear violations: multiple exclamation marks, rocket/fire emojis, ALL CAPS emphasis, or forced excitement that reads synthetic.
A single period-ended sentence or one understated "!" on a genuine milestone is acceptable.

### addsValueWithoutParroting
TRUE when the comment adds a distinct angle, observation, or question — even briefly.
Use the ORIGINAL POST as ground truth: referencing its topic is expected; that is not parroting.
FAIL only when the comment mostly restates the author's point with no new insight (summary echo with nothing added).

## OUTPUT
Return raw JSON only — no markdown fences:
{
  "assertions": {
    "avoidedSycophancy": true,
    "cleanVocabulary": true,
    "restrainedFormatting": true,
    "addsValueWithoutParroting": true
  },
  "reasoning": "One sentence per assertion: state the evidence, then pass/fail."
}`;
    
    const userPrompt = `ORIGINAL POST:
"${input.postText}"

GENERATED COMMENT TO EVALUATE:
"${input.generatedComment}"${avoidSection}`;

    const request = {
        system: judgeSystemPrompt,
        user: userPrompt,
    };

    try{
        const resp = await call(request, true);
        const judgeResult: AiToneEvalResult = parseJudgeResponse(resp, AI_TONE_ASSERTION_KEYS, "aiToneJudge");
        return judgeResult;
    }catch (error) {
        console.error("Error running AI tone judge:", error);
        throw error;
    }
}
