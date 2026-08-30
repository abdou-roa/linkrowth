import OpenAI from "openai";
import { getProviderConfig } from "../../config/llm";
import type { LlmRequest } from "../types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const { apiKey } = getProviderConfig("openai");
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY. Copy .env.example to .env and add your key.");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export async function call(request: LlmRequest): Promise<string> {
  const { defaultModel } = getProviderConfig("openai");
  const response = await getClient().chat.completions.create({
    model: request.model ?? defaultModel,
    max_completion_tokens: request.maxTokens ?? 1024,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Unexpected response from OpenAI");
  }

  return content;
}

export async function embed(texts: string[], model?: string): Promise<number[][]> {
  const { embedModel } = getProviderConfig("openai");
  const input = texts.map((t) => (t.trim() ? t : " "));
  const response = await getClient().embeddings.create({
    model: model ?? embedModel,
    input,
    encoding_format: "float",
  });

  const byIndex = [...response.data].sort((a, b) => a.index - b.index);
  if (byIndex.length !== input.length) {
    throw new Error(
      `OpenAI embeddings: expected ${input.length} vectors, got ${byIndex.length}`
    );
  }

  return byIndex.map((row) => row.embedding);
}
