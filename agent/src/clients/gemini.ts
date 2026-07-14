import { GoogleGenAI } from "@google/genai";
import { getProviderConfig } from "../config/env";
import type { LlmRequest } from "../types";

let ai: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!ai) {
    const { apiKey } = getProviderConfig("gemini");
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.");
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

export async function call(request: LlmRequest): Promise<string> {
  const { defaultModel } = getProviderConfig("gemini");
  const response = await getClient().models.generateContent({
    model: request.model ?? defaultModel,
    contents: request.user,
    config: {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens ?? 1024,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Unexpected response from Gemini");
  }

  return text;
}
