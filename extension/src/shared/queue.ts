/**
 * Concurrency-limited job queue for roosting / triage.
 * Default: 2 active jobs (see extension-integration.md).
 */
export class JobQueue {
  private pending: Array<() => Promise<void>> = [];
  private active = 0;

  constructor(private readonly concurrency: number = 2) {}

  enqueue(job: () => Promise<void>): void {
    this.pending.push(job);
    this.pump();
  }

  get size(): number {
    return this.pending.length + this.active;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) return;
      this.active += 1;
      void job().finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }
}
