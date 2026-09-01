import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserContext } from "../../core/types";
import type { ExperienceIndex } from "./experience/types";
import type {
  RetrievalTrace,
  RetrievalTraceSink,
} from "../persistence/retrievalTrace/types";
import {
  buildRetrievalQuery,
  retrieveContext,
} from "./retrieveContext";

/** Sink that records the last emitted trace for assertions. */
function capturingSink(): { sink: RetrievalTraceSink; last: () => RetrievalTrace } {
  let captured: RetrievalTrace | undefined;
  return {
    sink: {
      record(trace) {
        captured = trace;
      },
    },
    last: () => {
      assert.ok(captured, "expected a trace to be emitted");
      return captured;
    },
  };
}

const baseContext: UserContext = {
  niche: "AI engineering",
  positioning: "Builder",
  targetAudience: "Recruiters",
  proofPoints: ["Static proof point"],
};

function fixtureIndex(): ExperienceIndex {
  return {
    indexedAt: "2026-08-27T00:00:00Z",
    embedding: { provider: "test", model: "fake", dimensions: 3 },
    count: 3,
    items: [
      {
        id: "postgres",
        vector: [1, 0, 0],
        artifact: {
          id: "postgres",
          sourceCandidateId: "postgres",
          source: "local_git",
          repo: "linkrowth",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Postgres suggestion jobs",
          domains: ["postgres", "jobs"],
          stack: ["Postgres"],
          problem: "Need durable suggestion jobs",
          approach: "Queued rows with claim semantics",
          tradeoff: "In-process worker for now",
          claimableLine: "I built a Postgres-backed suggestion job queue with claim semantics.",
          confidence: "high",
          shareability: "public",
          paths: ["db/migrations/0001_init.sql"],
        },
      },
      {
        id: "private",
        vector: [0.99, 0.01, 0],
        artifact: {
          id: "private",
          sourceCandidateId: "private",
          source: "local_git",
          repo: "client-x",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Client secret work",
          domains: ["postgres"],
          stack: ["Postgres"],
          problem: "NDA work",
          approach: "Cannot discuss",
          tradeoff: "",
          claimableLine: "I cannot discuss this client work.",
          confidence: "high",
          shareability: "private",
          paths: [],
        },
      },
      {
        id: "extension",
        vector: [0, 1, 0],
        artifact: {
          id: "extension",
          sourceCandidateId: "extension",
          source: "local_git",
          repo: "linkrowth",
          implementationDate: "2026-08-01T00:00:00Z",
          title: "Chrome badges",
          domains: ["extension"],
          stack: ["Chrome"],
          problem: "Feed triage visibility",
          approach: "MV3 badges",
          tradeoff: "",
          claimableLine: "I ship LinkedIn feed triage badges in a Chrome MV3 extension.",
          confidence: "high",
          shareability: "public",
          paths: ["extension/src/content/badge.css"],
        },
      },
    ],
  };
}

describe("buildRetrievalQuery", () => {
  it("includes author headline when present", () => {
    const query = buildRetrievalQuery({
      text: "We moved suggestion jobs to Postgres.",
      author: { headline: "Staff Engineer" },
    });
    assert.equal(query.headline, "Staff Engineer");
    assert.match(query.situationQuery, /Postgres/);
    assert.doesNotMatch(query.situationQuery, /Staff Engineer/);
  });
});

describe("retrieveContext", () => {
  it("merges relevant public claimable lines into proofPoints", async () => {
    const index = fixtureIndex();
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => index,
        // Query vector aligned with the postgres artifact.
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
      }
    );

    assert.ok(enriched.proofPoints?.includes("Static proof point"));
    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      )
    );
    assert.ok(
      !enriched.proofPoints?.includes("I cannot discuss this client work."),
      "private artifacts must not become proof points"
    );
  });

  it("returns base context unchanged when the index is missing", async () => {
    const enriched = await retrieveContext(
      { text: "Anything about agents" },
      baseContext,
      {
        loadIndex: () => null,
        embedQuery: async () => {
          throw new Error("should not embed when index is missing");
        },
      }
    );
    assert.deepEqual(enriched, baseContext);
  });

  it("returns base context when embedQuery fails", async () => {
    const enriched = await retrieveContext(
      { text: "Anything about agents" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => {
          throw new Error("embed provider down");
        },
      }
    );
    assert.deepEqual(enriched, baseContext);
  });

  it("skips hits below the score floor", async () => {
    const enriched = await retrieveContext(
      { text: "unrelated topic" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        // Far from both axes → low scores after cosine with [1,0,0]/[0,1,0].
        embedQuery: async () => [0, 0, 1],
        minScore: 0.3,
        k: 5,
      }
    );
    assert.deepEqual(enriched.proofPoints, ["Static proof point"]);
  });
});

describe("retrieveContext trace emission", () => {
  it("emits an injected trace with candidates and index meta", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext(
      { text: "How do you run durable suggestion jobs without Kafka?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        traceSink: sink,
      }
    );

    const trace = last();
    assert.equal(trace.outcome, "injected");
    assert.equal(trace.schemaVersion, 1);
    assert.deepEqual(trace.params, {
      k: 3,
      minScore: 0.3,
      queryConstruction: {
        tier: "a",
        fallback: false,
        rawLength: "How do you run durable suggestion jobs without Kafka?".length,
        constructedLength: "How do you run durable suggestion jobs without Kafka?".length,
      },
    });
    assert.deepEqual(trace.index, {
      provider: "test",
      model: "fake",
      dimensions: 3,
      indexedAt: "2026-08-27T00:00:00Z",
      count: 3,
    });
    assert.deepEqual(trace.injectedProofPoints, [
      "I built a Postgres-backed suggestion job queue with claim semantics.",
    ]);

    const postgres = trace.candidates.find((c) => c.artifactId === "postgres");
    assert.ok(postgres?.selected, "postgres artifact should be selected");
    const priv = trace.candidates.find((c) => c.artifactId === "private");
    assert.equal(priv?.selected, false);
    assert.equal(priv?.dropReason, "shareability");
    assert.equal(trace.query.text, "How do you run durable suggestion jobs without Kafka?");
    assert.equal(trace.query.headline, undefined);
  });

  it("emits no_survivors when everything is filtered out", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "unrelated topic" }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => [0, 0, 1],
      minScore: 0.3,
      k: 5,
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "no_survivors");
    assert.deepEqual(trace.injectedProofPoints, []);
    assert.ok(trace.candidates.length > 0, "candidates should still be recorded");
    assert.ok(trace.candidates.every((c) => !c.selected));
  });

  it("emits no_index when the index is missing", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "anything" }, baseContext, {
      loadIndex: () => null,
      embedQuery: async () => {
        throw new Error("should not embed");
      },
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "no_index");
    assert.equal(trace.index, null);
  });

  it("emits embed_failed with index meta when embedding throws", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "anything" }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => {
        throw new Error("provider down");
      },
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "embed_failed");
    assert.ok(trace.index, "index meta should be present before embed failure");
    assert.deepEqual(trace.candidates, []);
  });

  it("embeds the situation query and records headline separately", async () => {
    const { sink, last } = capturingSink();
    let embedded = "";
    await retrieveContext(
      {
        text: "How do you run durable suggestion jobs without Kafka? 🔥\n\nThoughts?\n#engineering",
        author: { headline: "VP of Engineering | ex-Stripe" },
      },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async (text) => {
          embedded = text;
          return [1, 0, 0];
        },
        k: 3,
        minScore: 0.3,
        traceSink: sink,
      }
    );

    assert.equal(embedded, "How do you run durable suggestion jobs without Kafka?");
    assert.doesNotMatch(embedded, /Stripe/);
    const trace = last();
    assert.equal(trace.query.headline, "VP of Engineering | ex-Stripe");
    assert.equal(trace.query.text, embedded);
    assert.deepEqual(trace.params.queryConstruction, {
      tier: "a",
      fallback: false,
      rawLength:
        "How do you run durable suggestion jobs without Kafka? 🔥\n\nThoughts?\n#engineering".length,
      constructedLength: embedded.length,
    });
  });

  it("emits empty_query when there is nothing to search", async () => {
    const { sink, last } = capturingSink();
    await retrieveContext({ text: "   " }, baseContext, {
      loadIndex: () => fixtureIndex(),
      embedQuery: async () => [1, 0, 0],
      traceSink: sink,
    });
    const trace = last();
    assert.equal(trace.outcome, "empty_query");
    assert.equal(trace.index, null);
  });

  it("never lets a throwing sink break retrieval", async () => {
    const throwingSink: RetrievalTraceSink = {
      record() {
        throw new Error("sink exploded");
      },
    };
    const enriched = await retrieveContext(
      { text: "How do you run durable suggestion jobs?" },
      baseContext,
      {
        loadIndex: () => fixtureIndex(),
        embedQuery: async () => [1, 0, 0],
        k: 3,
        minScore: 0.3,
        traceSink: throwingSink,
      }
    );
    assert.ok(
      enriched.proofPoints?.includes(
        "I built a Postgres-backed suggestion job queue with claim semantics."
      ),
      "retrieval result must be unaffected by sink failure"
    );
  });
});
