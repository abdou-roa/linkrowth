import { randomUUID } from "node:crypto";
import type { RunRecord, RunRepository } from "./types";

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();

  async save(run: RunRecord): Promise<RunRecord> {
    const record: RunRecord = {
      ...run,
      id: run.id || randomUUID(),
    };
    this.runs.set(record.id, record);
    return record;
  }

  async getById(id: string): Promise<RunRecord | null> {
    return this.runs.get(id) ?? null;
  }

  async list(limit = 50): Promise<RunRecord[]> {
    const all = [...this.runs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    return all.slice(0, limit);
  }
}

/** Shared default repo for CLI/evals when none is injected. */
export const defaultRunRepository = new InMemoryRunRepository();
