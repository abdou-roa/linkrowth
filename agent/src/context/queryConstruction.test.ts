import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildRetrievalQuery,
  cleanSituationText,
  parseQueryConstructionTier,
} from "./queryConstruction";

describe("parseQueryConstructionTier", () => {
  it("defaults to Tier A", () => {
    assert.equal(parseQueryConstructionTier(undefined), "a");
    assert.equal(parseQueryConstructionTier(""), "a");
    assert.equal(parseQueryConstructionTier("a"), "a");
  });

  it("accepts raw baseline aliases", () => {
    assert.equal(parseQueryConstructionTier("raw"), "raw");
    assert.equal(parseQueryConstructionTier("baseline"), "raw");
  });
});

describe("buildRetrievalQuery", () => {
  afterEach(() => {
    delete process.env.LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION;
  });

  it("returns headline as a sibling field and keeps it out of situationQuery", () => {
    const query = buildRetrievalQuery({
      text: "We moved suggestion jobs to Postgres.",
      author: { headline: "VP of Engineering | ex-Stripe | speaker" },
    });

    assert.equal(query.headline, "VP of Engineering | ex-Stripe | speaker");
    assert.equal(query.situationQuery, "We moved suggestion jobs to Postgres.");
    assert.equal(query.tier, "a");
    assert.equal(query.fallback, false);
    assert.doesNotMatch(query.situationQuery, /Author headline/);
    assert.doesNotMatch(query.situationQuery, /Stripe/);
  });

  it("does not use a headline-only post as the situation query", () => {
    const query = buildRetrievalQuery({
      text: "   ",
      author: { headline: "Staff Engineer" },
    });
    assert.equal(query.situationQuery, "");
    assert.equal(query.headline, "Staff Engineer");
  });

  it("strips hashtag walls, mentions, emojis, and trailing CTAs", () => {
    const query = buildRetrievalQuery({
      text: [
        "Our queue dropped tasks 🔥 under load @alice.",
        "",
        "Thoughts?",
        "#engineering #backend #hiring",
      ].join("\n"),
    });

    assert.equal(query.situationQuery, "Our queue dropped tasks under load.");
    assert.equal(query.fallback, false);
  });

  it("keeps inline hashtag words so technical terms are not deleted", () => {
    const query = buildRetrievalQuery({
      text: "We chose #postgres over MySQL for durable jobs.",
    });
    assert.equal(query.situationQuery, "We chose postgres over MySQL for durable jobs.");
  });

  it("falls back to the trimmed raw body when cleaning would empty the query", () => {
    const body = "#hiring #opentowork\n🔥🔥\n@recruiter";
    const query = buildRetrievalQuery({ text: body });
    assert.equal(query.fallback, true);
    assert.equal(query.situationQuery, body);
  });

  it("restores the raw-blob baseline when the strategy flag is raw", () => {
    const query = buildRetrievalQuery(
      {
        text: "We moved suggestion jobs to Postgres.",
        author: { headline: "Staff Engineer" },
      },
      { tier: "raw" }
    );
    assert.equal(query.tier, "raw");
    assert.equal(
      query.situationQuery,
      "Author headline: Staff Engineer\n\nWe moved suggestion jobs to Postgres."
    );
    assert.equal(query.headline, "Staff Engineer");
  });
});

describe("cleanSituationText", () => {
  it("collapses whitespace while keeping paragraph breaks", () => {
    const cleaned = cleanSituationText("Jobs   stalled.\n\n\nThen we  rewrote  the  worker.");
    assert.equal(cleaned.text, "Jobs stalled.\n\nThen we rewrote the worker.");
    assert.equal(cleaned.fallback, false);
  });
});
