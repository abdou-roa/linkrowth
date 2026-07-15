import { getActiveProviderConfig } from "./config/env";
import { call as claudeCall } from "./clients/claude";
import { call as geminiCall } from "./clients/gemini";
import { call as gptCall } from "./clients/gpt";
import { call as kimiCall } from "./clients/kimi";
import type { LlmProvider, LlmRequest } from "./types";

const handlers: Record<LlmProvider, (request: LlmRequest) => Promise<string>> = {
  openai: gptCall,
  gemini: geminiCall,
  anthropic: claudeCall,
  kimi: kimiCall,
};

export async function call(request: LlmRequest): Promise<string> {
  const { provider } = getActiveProviderConfig();
  return handlers[provider](request);
}
