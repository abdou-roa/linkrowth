import { runEngage, type RunEngageOptions } from "./runs/service";
import type { EngageResult, Post, UserContext } from "./types";
import type { RunRecord } from "./runs/types";

export type EngageOptions = RunEngageOptions;

export async function engage(
  post: Post,
  context?: UserContext,
  options: Omit<EngageOptions, "context"> = {}
): Promise<EngageResult> {
  const run = await runEngage(post, { ...options, context });
  return run.result;
}

export async function engageRun(
  post: Post,
  context?: UserContext,
  options: Omit<EngageOptions, "context"> = {}
): Promise<RunRecord> {
  return runEngage(post, { ...options, context });
}
