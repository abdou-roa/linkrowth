import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToneJudgeInput, EvalDataset, EvalCategory, allowedCategories } from "./types";
import { engage } from "../src/engage";
import { runToneJudge } from "./judges/toneJudge";
import { runAiToneJudge } from "./judges/aiToneJudge";

// Intentionally forgiving while the golden dataset is small and LLM judges are noisy.
// Tighten these as dataset coverage and judge calibration improve.
const QUALITY_GATES = {
  categoryPassRateMin: 70,
  toneAssertionScoreMin: 70,
  aiAssertionScoreMin: 75,
} as const;

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

  // Trackers for categories
  let passedCategories = 0;

  // Trackers for granular tone assertions
  let totalToneAssertionsRun = 0;
  let totalToneAssertionsPassed = 0;

  // Trackers for granular AI tone assertions
  let totalAiAssertionsRun = 0;
  let totalAiAssertionsPassed = 0;

  // Specific metric counters for hyper-targeted debugging
  let vocabularyFailures = 0;
  let sycophancyFailures = 0;


  for (const test_case of dataset) {
    const EngageResult = await engage({ text: test_case.postText }, userConfig);

    const input: ToneJudgeInput = {
      generatedComment: EngageResult.suggestion,
      postText: test_case.postText,
      voiceNotes: userConfig.voiceNotes,
      voiceSamples: userConfig.voiceSamples || [],
      avoid: userConfig.avoid,
    };

    try{
      const allowed = allowedCategories(test_case.category);
      const predicted = EngageResult.category?.trim() as EvalCategory | undefined;
      if (predicted && allowed.includes(predicted)) passedCategories++;

      const toneResult = await runToneJudge(input);
      const toneFlags = Object.values(toneResult.assertions);
      totalToneAssertionsRun += toneFlags.length;
      totalToneAssertionsPassed += toneFlags.filter(Boolean).length;

      const aiResult = await runAiToneJudge(input);
      const aiFlags = Object.values(aiResult.assertions);
      totalAiAssertionsRun += aiFlags.length;
      totalAiAssertionsPassed += aiFlags.filter(Boolean).length;

      // Deep debugging tracking
      if (!aiResult.assertions.cleanVocabulary) vocabularyFailures++;
      if (!aiResult.assertions.avoidedSycophancy) sycophancyFailures++;

    }catch (error) {
      console.error("Error during evaluation:", error);
    }
  }
    // Calculate clean, mathematical percentages based on assertions
  const categoryPassRate = (passedCategories / totalCases) * 100;
  const toneAssertionScore = (totalToneAssertionsPassed / totalToneAssertionsRun) * 100;
  const aiAssertionScore = (totalAiAssertionsPassed / totalAiAssertionsRun) * 100;

  console.log("\n📊 === MULTI-DIMENSIONAL EVAL SUMMARY ===");
  console.log(`Category Match Rate : ${categoryPassRate.toFixed(1)}%`);
  console.log(`Tone Style Fit Score : ${toneAssertionScore.toFixed(1)}% (${totalToneAssertionsPassed}/${totalToneAssertionsRun} assertions)`);
  console.log(`AI Cringe Safe Score : ${aiAssertionScore.toFixed(1)}% (${totalAiAssertionsPassed}/${totalAiAssertionsRun} assertions)`);
  
  if (vocabularyFailures > 0 || sycophancyFailures > 0) {
    console.log(`\n🔍 Prompts Debugging Insights:`);
    console.log(`  - Caught ${vocabularyFailures} instances of robotic vocabulary.`);
    console.log(`  - Caught ${sycophancyFailures} instances of generic enthusiasm.`);
  }
  console.log("=========================================\n");

  // Quality Gates Enforcement
  let triggerPipelineFail = false;

  if (categoryPassRate < QUALITY_GATES.categoryPassRateMin) triggerPipelineFail = true;
  if (toneAssertionScore < QUALITY_GATES.toneAssertionScoreMin) triggerPipelineFail = true;
  if (aiAssertionScore < QUALITY_GATES.aiAssertionScoreMin) triggerPipelineFail = true;

  if (triggerPipelineFail) {
    console.error("❌ Quality gate thresholds missed. Blocking deployment.");
    process.exit(1);
  }

  console.log("✅ All multi-dimensional criteria satisfied.");
  process.exit(0);
}

runEvaluation();
