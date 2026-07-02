import { readFileSync } from "node:fs";
import path, { join } from "node:path";
import { ToneJudgeInput, EvalDataset } from "./types";
import { engage } from "../src/engage";
import { runToneJudge } from "./judges/toneJudge";
import { runAiToneJudge } from "./judges/aiToneJudge";

function loadEvalDataset(): EvalDataset[] | undefined
{
  try{
    const filePath = join(process.cwd(), "evals", "dataset.json");
    const rawDataset = readFileSync(filePath, 'utf8');
    const data: EvalDataset[] = JSON.parse(rawDataset);
    return data
  }catch (error) {
    console.error("Error loading evaluation dataset:", error);
  }
}

function loadUserconfig(): any
{
  try{
    const filePath = join(process.cwd(), "config", "user.json");
    const rawConfig = readFileSync(filePath, 'utf8');
    const data: any = JSON.parse(rawConfig);
    return data
  }catch (error) {
    console.error("Error loading user configuration:", error);
  }
}

async function runEvaluation(): Promise<void>
{
  const dataset = loadEvalDataset();
  const userConfig = loadUserconfig();

  if (!dataset || !userConfig) {
    console.error("Dataset or user configuration is missing. Exiting evaluation.");
    return;
  }

  for (const test_case of dataset) {
    const EngageResult = await engage({ text: test_case.postText }, userConfig);

    const input: ToneJudgeInput = {
      generatedComment: EngageResult.suggestion,
      voiceNotes: userConfig.voiceNotes,
      voiceSamples: userConfig.voiceSamples || [],
    };

    try{
      const categoryJudegeResult = EngageResult.category === test_case.category;
      const toneJudgeResult = await runToneJudge(input);
      const aiToneJudgeResult = await runAiToneJudge(input);

      console.log("\n____________________Evaluation Result____________________");
      console.log(categoryJudegeResult ? "Category Judge: PASS" : "Category Judge: FAIL");
      console.log("\n")
      console.log(toneJudgeResult.pass ? "Tone Judge: PASS" : "Tone Judge: FAIL");
      console.log("Tone Judge Reasoning:", toneJudgeResult.reasoning);
      console.log("\n")
      console.log(aiToneJudgeResult.pass ? "AI Tone Judge: PASS" : "AI Tone Judge: FAIL");
      console.log("AI Tone Judge Reasoning:", aiToneJudgeResult.reasoning);
      console.log("_______________________________________________________\n\n\n")
      console.log("_______________________________________________________\n\n\n")
    }catch (error) {
      console.error("Error during evaluation:", error);
    }
  }
}

runEvaluation()