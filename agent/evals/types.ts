export interface JudgeResult {
  pass: boolean;
  reasoning: string;
}

export interface ToneJudgeInput {
  generatedComment: string;
  voiceNotes: string;
  voiceSamples: string[];
}

export interface EvalDataset {
  id: string;
  postText: string;
  category: "Technical" | "Informal" | "Achievement";
}
