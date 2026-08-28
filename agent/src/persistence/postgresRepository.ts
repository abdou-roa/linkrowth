import { saveSuggestionRun } from "@linkrowth/db";
import type { RunRecord, RunRepository } from "./types";

class PostgresRunRepository implements RunRepository {
  async save(run: RunRecord): Promise<RunRecord> {
    const saved = await saveSuggestionRun({
      ...run,
      post: { ...run.post, id: run.postId },
    });
    return { ...run, jobId: saved.jobId };
  }
}

export function createPostgresRunRepository(): RunRepository {
  return new PostgresRunRepository();
}
