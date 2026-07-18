import type { TriageEntry } from "./types";

const STORAGE_KEY = "linkrowth.triage.session";

/** Session triage board — chrome.storage.session when available, else memory. */
export class TriageStore {
  private memory = new Map<string, TriageEntry>();

  async list(): Promise<TriageEntry[]> {
    const fromChrome = await this.readChrome();
    if (fromChrome) {
      return Object.values(fromChrome).sort(sortEntries);
    }
    return [...this.memory.values()].sort(sortEntries);
  }

  async get(feedPostId: string): Promise<TriageEntry | undefined> {
    const all = await this.asMap();
    return all.get(feedPostId);
  }

  async has(feedPostId: string): Promise<boolean> {
    return (await this.get(feedPostId)) !== undefined;
  }

  async upsert(entry: TriageEntry): Promise<void> {
    const map = await this.asMap();
    map.set(entry.post.id, entry);
    await this.write(map);
  }

  async clear(): Promise<void> {
    this.memory.clear();
    if (chrome?.storage?.session) {
      await chrome.storage.session.remove(STORAGE_KEY);
    }
  }

  async removeMany(feedPostIds: string[]): Promise<void> {
    if (feedPostIds.length === 0) return;
    const map = await this.asMap();
    for (const id of feedPostIds) {
      map.delete(id);
    }
    await this.write(map);
  }

  private async asMap(): Promise<Map<string, TriageEntry>> {
    const fromChrome = await this.readChrome();
    if (fromChrome) {
      return new Map(Object.entries(fromChrome));
    }
    return this.memory;
  }

  private async readChrome(): Promise<Record<string, TriageEntry> | null> {
    if (!chrome?.storage?.session) return null;
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    if (!value || typeof value !== "object") return null;
    return value as Record<string, TriageEntry>;
  }

  private async write(map: Map<string, TriageEntry>): Promise<void> {
    this.memory = map;
    if (!chrome?.storage?.session) return;
    const obj = Object.fromEntries(map.entries());
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  }
}

function sortEntries(a: TriageEntry, b: TriageEntry): number {
  const rank = (s: string) => (s === "worth_it" ? 0 : s === "failed" ? 2 : 1);
  const byStatus = rank(a.triage.status) - rank(b.triage.status);
  if (byStatus !== 0) return byStatus;
  return b.triage.score - a.triage.score;
}

export const triageStore = new TriageStore();
