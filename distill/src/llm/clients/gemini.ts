import { GoogleGenAI } from "@google/genai";
import { getProviderConfig } from "../../config/llm";
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
      ...(request.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Unexpected response from Gemini");
  }

  return text;
}

function valuesFromEmbedding(row: unknown): number[] | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { values?: unknown; embedding?: { values?: unknown } };
  if (Array.isArray(record.values) && record.values.every((n) => typeof n === "number")) {
    return record.values as number[];
  }
  const nested = record.embedding?.values;
  if (Array.isArray(nested) && nested.every((n) => typeof n === "number")) {
    return nested as number[];
  }
  return null;
}

export async function embed(texts: string[], model?: string): Promise<number[][]> {
  const { embedModel } = getProviderConfig("gemini");
  const input = texts.map((t) => (t.trim() ? t : " "));
  const response = await getClient().models.embedContent({
    model: model ?? embedModel,
    contents: input,
    config: { taskType: "RETRIEVAL_DOCUMENT" },
  });

  const rows = (response.embeddings ?? []) as unknown[];
  const vectors = rows.map(valuesFromEmbedding);
  if (vectors.some((v) => v === null) || vectors.length !== input.length) {
    throw new Error(
      `Gemini embeddings: expected ${input.length} vectors, got ${vectors.filter(Boolean).length}`
    );
  }

  return vectors as number[][];
}

export async function embedQuery(text: string, model?: string): Promise<number[]> {
  const { embedModel } = getProviderConfig("gemini");
  const response = await getClient().models.embedContent({
    model: model ?? embedModel,
    contents: text.trim() ? text : " ",
    config: { taskType: "RETRIEVAL_QUERY" },
  });

  const rows = (response.embeddings ?? []) as unknown[];
  const vector = valuesFromEmbedding(rows[0]);
  if (!vector) {
    throw new Error("Gemini embeddings: empty query vector");
  }
  return vector;
}
