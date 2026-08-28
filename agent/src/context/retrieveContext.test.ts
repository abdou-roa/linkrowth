import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserContext } from "../../core/types";
import type { ExperienceIndex } from "./experience/types";
import {
  buildRetrievalQuery,
  retrieveContext,
} from "./retrieveContext";

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
    assert.match(query, /Staff Engineer/);
    assert.match(query, /Postgres/);
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
