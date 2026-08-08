export type LlmProvider = "openai" | "gemini";

export interface LlmPrompt {
  system: string;
  user: string;
}

export interface LlmRequest extends LlmPrompt {
  model?: string;
  maxTokens?: number;
}
