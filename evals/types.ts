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
  voiceNotes: string;
  voiceSamples: string[];
  avoid?: string[];
}

export interface EvalDataset {
  id: string;
  postText: string;
  category: "Technical" | "Informal" | "Achievement";
  personalNotes: string  
}

