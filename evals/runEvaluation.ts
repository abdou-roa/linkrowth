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

  const totalCases = dataset.length;

  let passedCategoryCount = 0;
  let passedToneJudgeCount = 0;
  let passedAiToneJudgeCount = 0;

  for (const test_case of dataset) {
    const EngageResult = await engage({ text: test_case.postText }, userConfig);

    const input: ToneJudgeInput = {
      generatedComment: EngageResult.suggestion,
      voiceNotes: userConfig.voiceNotes,
      voiceSamples: userConfig.voiceSamples || [],
    };

    try{
      const categoryJudegeResult = EngageResult.category === test_case.category;
      categoryJudegeResult ? passedCategoryCount++ : null;

      const toneJudgeResult = await runToneJudge(input);
      toneJudgeResult.pass ? passedToneJudgeCount++ : null;

      const aiToneJudgeResult = await runAiToneJudge(input);
      aiToneJudgeResult.pass ? passedAiToneJudgeCount++ : null;

    }catch (error) {
      console.error("Error during evaluation:", error);
    }
  }
    console.log("\n==================================================");
    console.log("📊 FINAL EVALUATION SUMMARY");
    console.log("==================================================");
    console.log(`✅ ${passedCategoryCount}/${totalCases} category evals passed`);
    console.log(`✅ ${passedToneJudgeCount}/${totalCases} tone evals passed`);
    console.log(`✅ ${passedAiToneJudgeCount}/${totalCases} AI tone evals passed`);
    console.log("==================================================\n");
}

runEvaluation()