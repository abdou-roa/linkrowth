import { getActiveProviderConfig } from "../config/llm";
import { call as geminiCall, embed as geminiEmbed, embedQuery as geminiEmbedQuery } from "./clients/gemini";
import { call as gptCall, embed as gptEmbed } from "./clients/gpt";
import type { LlmProvider, LlmRequest } from "./types";

const handlers: Record<LlmProvider, (request: LlmRequest) => Promise<string>> = {
  openai: gptCall,
  gemini: geminiCall,
};

const embedHandlers: Record<LlmProvider, (texts: string[], model?: string) => Promise<number[][]>> = {
  openai: gptEmbed,
  gemini: geminiEmbed,
};

export async function call(request: LlmRequest): Promise<string> {
  const { provider } = getActiveProviderConfig();
  return handlers[provider](request);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { provider, embedModel } = getActiveProviderConfig();
  return embedHandlers[provider](texts, embedModel);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { provider, embedModel } = getActiveProviderConfig();
  if (provider === "gemini") {
    return geminiEmbedQuery(text, embedModel);
  }
  const [vector] = await gptEmbed([text], embedModel);
  if (!vector) {
    throw new Error("OpenAI embeddings: empty query vector");
  }
  return vector;
}

export type { LlmProvider, LlmPrompt, LlmRequest } from "./types";
