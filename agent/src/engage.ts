import { runEngage, type RunEngageOptions } from "./runs/service";
import type { EngageResult, Post, UserContext } from "./types";

export async function engage(
  post: Post,
  context?: UserContext,
  options: Omit<RunEngageOptions, "context"> = {}
): Promise<EngageResult> {
  const run = await runEngage(post, { ...options, context });
  return run.result;
}
