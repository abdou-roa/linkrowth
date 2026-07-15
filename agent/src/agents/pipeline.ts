import type { PipelineContext, PipelineStep, ReasoningStep } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Runs an ordered list of steps, capturing timing and failures for each.
 * Stops on the first failed step and includes that failure in the returned trace.
 */
export async function runPipeline(
  steps: PipelineStep[],
  ctx: PipelineContext
): Promise<ReasoningStep[]> {
  const trace: ReasoningStep[] = [];

  for (const step of steps) {
    const startedAt = nowIso();
    try {
      const output = await step.run(ctx);
      trace.push({
        name: step.name,
        status: "completed",
        output,
        startedAt,
        completedAt: nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.push({
        name: step.name,
        status: "failed",
        error: message,
        startedAt,
        completedAt: nowIso(),
      });
      break;
    }
  }

  return trace;
}
