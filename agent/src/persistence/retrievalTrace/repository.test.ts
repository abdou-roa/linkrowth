import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  InMemoryRetrievalTraceRepository,
  NoopRetrievalTraceRepository,
  createRetrievalTraceRepository,
} from "./repository";
import { RETRIEVAL_TRACE_SCHEMA_VERSION } from "./types";
import type { RetrievalTrace } from "./types";

const sampleTrace: RetrievalTrace = {
  schemaVersion: RETRIEVAL_TRACE_SCHEMA_VERSION,
  outcome: "injected",
  query: { text: "durable suggestion jobs" },
  index: {
    provider: "test",
    model: "fake",
    dimensions: 3,
    indexedAt: "2026-08-27T00:00:00Z",
    count: 3,
  },
  params: { k: 5, minScore: 0.3 },
  candidates: [
    { artifactId: "postgres", score: 0.91, rank: 0, selected: true },
  ],
  injectedProofPoints: ["I built a Postgres-backed suggestion job queue."],
  timings: { embedMs: 1, totalMs: 2 },
};

describe("InMemoryRetrievalTraceRepository", () => {
  it("stores traces with their refs", async () => {
    const repo = new InMemoryRetrievalTraceRepository();
    await repo.save(sampleTrace, { agentId: "multi-step", runId: "run-1", postId: "p1" });

    assert.equal(repo.saved.length, 1);
    assert.equal(repo.saved[0]?.trace.outcome, "injected");
    assert.deepEqual(repo.saved[0]?.refs, {
      agentId: "multi-step",
      runId: "run-1",
      postId: "p1",
    });
  });
});

describe("NoopRetrievalTraceRepository", () => {
  it("accepts traces without throwing", async () => {
    const repo = new NoopRetrievalTraceRepository();
    await assert.doesNotReject(repo.save(sampleTrace, {}));
  });
});

describe("createRetrievalTraceRepository", () => {
  const original = process.env.LINKROWTH_RETRIEVAL_TRACE;
  afterEach(() => {
    if (original === undefined) delete process.env.LINKROWTH_RETRIEVAL_TRACE;
    else process.env.LINKROWTH_RETRIEVAL_TRACE = original;
  });

  it("defaults to the no-op repository when the flag is unset", () => {
    delete process.env.LINKROWTH_RETRIEVAL_TRACE;
    assert.ok(createRetrievalTraceRepository() instanceof NoopRetrievalTraceRepository);
  });

  it("stays no-op for falsey flag values", () => {
    process.env.LINKROWTH_RETRIEVAL_TRACE = "0";
    assert.ok(createRetrievalTraceRepository() instanceof NoopRetrievalTraceRepository);
  });
});
