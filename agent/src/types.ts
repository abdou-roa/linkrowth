export type LlmProvider = "openai" | "gemini" | "anthropic" | "kimi";

/** Author fields aligned with helpers/schema.sql posts.author_* columns. */
export interface PostAuthor {
  name?: string;
  headline?: string;
  profileUrl?: string;
  username?: string;
}

export interface PostMetrics {
  likes?: number;
  commentsCount?: number;
}

export interface PostComment {
  author?: string;
  text: string;
  likes?: number;
}

/**
 * Feed post shape aligned with helpers/schema.sql `posts`.
 * CLI may pass only `{ text }`; id is assigned before persistence.
 */
export interface Post {
  id?: string;
  url?: string;
  text: string;
  author?: PostAuthor;
  metrics?: PostMetrics;
  comments?: PostComment[];
  ageText?: string;
  extractedAt?: string;
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
