//evals

export interface JudgeResult {
  pass: boolean;
  reasoning: string;
}
export interface ToneEvalResult {
  assertions: {
    lengthAndLineBounds: boolean;
    matchesPacingAndComplexity: boolean;
    retainsGrit: boolean;
    organicTransitions: boolean;
  };
  reasoning: string;
}
export interface AiToneEvalResult {
  assertions: {
    avoidedSycophancy: boolean;
    cleanVocabulary: boolean;
    restrainedFormatting: boolean;
    addsValueWithoutParroting: boolean;
  };
  reasoning: string;
}

export interface ToneJudgeInput {
  generatedComment: string;
  postText: string;
  voiceNotes: string;
  voiceSamples: string[];
  avoid?: string[];
}

export type EvalCategory = "Technical" | "Informal" | "Achievement";

export interface EvalDataset {
  id: string;
  postText: string;
  /** One or more acceptable categories — a match against any counts as a pass. */
  category: EvalCategory | EvalCategory[];
  personalNotes: string;
}

/** Normalize a dataset category field to a flat list for matching. */
export function allowedCategories(category: EvalCategory | EvalCategory[]): EvalCategory[] {
  return Array.isArray(category) ? category : [category];
}

