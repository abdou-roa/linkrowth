import { JudgeResult } from "../types"
import { ToneJudgeInput } from "../types"
import {call} from "../../src/llm"


export async function runToneJudge(input: ToneJudgeInput): Promise<JudgeResult>
{
  const toneJudgePropmt = `You are a forensic linguistic specialist evaluating text for style matching. 

  Your objective is to determine if a generated comment accurately mirrors the stylistic behavior, voice constraints, and linguistic rhythms of a target Author profile.

  EVALUATION RUBRIC:
  1. Hard Constraints: Does the text violate explicit boundaries set in the Voice Notes (e.g., sentence count over 4 lines, overly enthusiastic if directness was requested)?
  2. Stylistic Grip: Compare the comment's sentence complexity and pacing to the provided Voice Samples. Does it match the human's "grit" or does it drift into smooth, sterilized syntax?
  3. Link-Word Consistency: Look for organic structural phrasing alignment with the sample text rather than formal transitions.

  You must return a raw JSON object matching this schema. Do not include markdown formatting or backticks:
  {
    "pass": true or false,
    "reasoning": "Analyze hard constraint alignment first, then analyze style variance versus the voice samples." 
  }`;

  const userPrompt = `TARGET AUTHOR VOICE PARAMETERS:
  - Explicit Voice Notes: "${input.voiceNotes}"
  - (If existing) Reference Voice Samples:
  ${input.voiceSamples.map((sample, index) => `  Sample ${index + 1}: "${sample}"`).join('\n')}

  GENERATED TEXT TO EVALUATE:
  "${input.generatedComment}"`;

  const request = {
    system: toneJudgePropmt,
    user: userPrompt,
  };

  try{
    const resp = await call(request, true);
    const judgeResult: JudgeResult = JSON.parse(resp);
    return judgeResult;
  }catch (error) {
    console.error("Error running tone judge:", error);
    throw error;
  }
}
