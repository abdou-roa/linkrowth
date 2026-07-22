import { call } from "../llm";
import { buildEngagePrompt } from "./prompt";
import { parseEngageResponse } from "./parse";
import type { EngageResult, Post, UserContext } from "./types";

/**
 * Pure engage core: post + context → suggestion. No persistence, no DB, no job
 * lifecycle. Wrapping layers (persistence, RAG context assembly, CLI, API worker)
 * compose around this without changing it.
 */
export async function engage(
  post: Post,
  context: UserContext
): Promise<EngageResult> {
  const prompt = buildEngagePrompt(post, context);
  const response = await call(prompt);
  return parseEngageResponse(response);
}
