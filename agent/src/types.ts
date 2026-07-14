export type LlmProvider = "openai" | "gemini" | "anthropic" | "kimi";

export interface Post {
  text: string;
  author?: { name?: string; role?: string };
}

export interface UserContext {
  niche: string;
  positioning: string;
  targetAudience: string;
  background?: string;
  proofPoints?: string[];
  opinions?: string[];
  avoid?: string[];
  voiceSamples?: string[];
  voiceNotes?: string;
}

export interface EngageResult {
  category?: string;
  coreSubject?: string;
  appliedPlaybook?: string;
  valueHook?: string;
  voiceCheck?: string;
  suggestion: string;
  rationale: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  max_completion_tokens?: number;
}

export interface LlmPrompt {
  system: string;
  user: string;
}
