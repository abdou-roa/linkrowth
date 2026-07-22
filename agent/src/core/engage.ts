import { call } from "../llm";
import { buildEngagePrompt } from "./prompt";
import { parseEngageResponse } from "./parse";
import type { EngageResult, Post, UserContext } from "./types";

/** Identifies the engage implementation that produced a result (persisted as agent_id). */
export const ENGAGE_AGENT_ID = "one_shot_engage";

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
