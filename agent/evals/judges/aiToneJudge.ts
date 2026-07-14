//this file contains ai tone judge evaluation logic
import { JudgeResult } from "../types"
import { ToneJudgeInput } from "../types"
import { call } from "../../src/llm";

export async function runAiToneJudge(input: ToneJudgeInput): Promise<JudgeResult>
{
    const judgeSystemPrompt = `You are an elite QA Editor auditing text for "AI Cringe", corporate sycophancy, and typical robotic language patterns.
    Your job is to strictly evaluate whether a generated social media comment sounds like an AI or an authentic human professional.

    CRITICAL FAILURE PATTERNS (If any are present, the text FAILS):
    1. Sycophantic openings or generic enthusiastic filler (e.g., "Spot on!", "Insightful share!", "Couldn't agree more!", "Great perspective!").
    2. AI vocabulary anchors (e.g., "delve", "testament", "tapestry", "foster", "equally", "moreover", "in today's fast-paced world").
    3. Excessive punctuation or forced hype (e.g., Exclamation marks '!', rocket emojis, or summary echo chambers that just parrot the author's words back to them).

    You must return a raw JSON object matching this schema. Do not include markdown formatting or backticks:
    {
    "reasoning": "Step-by-step evaluation checking for openings, forbidden vocabulary, and general synth-tone.",
    "pass": true or false
    }`;
    
    const userPrompt = `Evaluate this generated comment:\n"${input.generatedComment}"`;
    const request = {
        system: judgeSystemPrompt,
        user: userPrompt,
    };

    try{
        const resp = await call(request);
        const judgeResult: JudgeResult = JSON.parse(resp);
        return judgeResult;
    }catch (error) {
        console.error("Error running tone judge:", error);
        throw error;
    }
}