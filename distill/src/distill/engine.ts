import type { LlmRequest } from "../llm/types";
import type { DistillDropRecord, ExperienceArtifact, RawExperienceCandidate } from "../types";
import { envFlag, envInt, mapPool } from "../util/pool";
import { distillOne, type LoadDiff } from "./one";

export type LlmCall = (request: LlmRequest) => Promise<string>;

export interface DistillResult {
  artifacts: ExperienceArtifact[];
  dropped: DistillDropRecord[];
}

export interface DistillOptions {
  call: LlmCall;
  concurrency?: number;
  /** Skip candidates whose id is already in existingArtifacts (unless force). */
  existingArtifacts?: ExperienceArtifact[];
  force?: boolean;
  limit?: number;
  loadDiff?: LoadDiff;
  onProgress?: (done: number, total: number, kept: number, dropped: number) => void;
}

export async function distillCandidates(
  candidates: RawExperienceCandidate[],
  options: DistillOptions
): Promise<DistillResult> {
  const force = options.force ?? envFlag("DISTILL_FORCE");
  const limit = options.limit ?? envInt("DISTILL_LIMIT", 0);
  const concurrency = options.concurrency ?? envInt("DISTILL_CONCURRENCY", 3);

  const existing = force ? [] : (options.existingArtifacts ?? []);
  const existingIds = new Set(existing.map((a) => a.id));

  const pending = candidates.filter((c) => !existingIds.has(c.id));
  const work = limit > 0 ? pending.slice(0, limit) : pending;

  let done = 0;
  let kept = existing.length;
  let droppedCount = 0;

  const outcomes = await mapPool(work, concurrency, async (candidate) => {
    const outcome = await distillOne(candidate, options.call, options.loadDiff);
    done += 1;
    if (outcome.kind === "artifact") kept += 1;
    else droppedCount += 1;
    options.onProgress?.(done, work.length, kept, droppedCount);
    return outcome;
  });

  const artifacts = [...existing];
  const dropped: DistillDropRecord[] = [];

  for (const outcome of outcomes) {
    if (outcome.kind === "artifact") artifacts.push(outcome.artifact);
    else dropped.push(outcome.drop);
  }

  return { artifacts, dropped };
}
