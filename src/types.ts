export type LlmProvider = "openai" | "gemini" | "anthropic" | "kimi";

export interface Post {
  text: string;
  author?: { name?: string; role?: string };
}

export interface UserContext {
  niche: string;
  positioning: string;
  targetAudience: string;
  voiceSamples?: string[];
}

export interface EngageResult {
  suggestion: string;
  rationale: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}

export interface LlmPrompt {
  system: string;
  user: string;
}
