import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildEvidenceQuery,
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

describe("buildEvidenceQuery", () => {
  it("assembles all analysis fields into a query string", () => {
    const { evidenceQuery, provenance } = buildEvidenceQuery({
      category: "technical",
      coreThesis: "Silent job loss makes retry behavior untrustworthy.",
      tone: "analytical",
      authorProfile: { isTechnical: true, seniority: "ic" },
      postQuestions: [
        { text: "How do teams handle durable retries without Kafka?", decision: "answer", reason: "direct ask" },
        { text: "Agree?", decision: "omit", reason: "rhetorical" },
      ],
      unspokenTradeoffs: ["Operational overhead of explicit acknowledgements."],
      riskFlags: [],
      pivotStrategy: {
        acknowledgedPoint: "Silent loss is a real operational pain.",
        insightDirection: "Offer a smaller-system pattern based on explicit delivery acknowledgement.",
      },
      responseParameters: { technicalDepth: "high", suggestedLength: "standard" },
    });

    assert.match(evidenceQuery, /Silent job loss makes retry behavior untrustworthy/);
    assert.match(evidenceQuery, /explicit delivery acknowledgement/);
    assert.match(evidenceQuery, /Silent loss is a real operational pain/);
    assert.match(evidenceQuery, /How do teams handle durable retries without Kafka/);
    assert.match(evidenceQuery, /Operational overhead/);
    assert.doesNotMatch(evidenceQuery, /Agree\?/); // omitted question excluded

    assert.equal(provenance.hasCoreThesis, true);
    assert.equal(provenance.hasInsightDirection, true);
    assert.equal(provenance.hasAcknowledgedPoint, true);
    assert.equal(provenance.answerableQuestionCount, 1);
    assert.equal(provenance.unspokenTradeoffCount, 1);
  });

  it("returns an empty string when analysis has no usable signals", () => {
    const { evidenceQuery, provenance } = buildEvidenceQuery({
      category: "informal",
      coreThesis: "",
      tone: "neutral",
      authorProfile: { isTechnical: false, seniority: "unknown" },
      postQuestions: [],
      unspokenTradeoffs: [],
      riskFlags: [],
      pivotStrategy: { acknowledgedPoint: "", insightDirection: "" },
      responseParameters: { technicalDepth: "accessible", suggestedLength: "short" },
    });

    assert.equal(evidenceQuery, "");
    assert.equal(provenance.hasCoreThesis, false);
    assert.equal(provenance.answerableQuestionCount, 0);
  });

  it("excludes omit-classified questions from the evidence query", () => {
    const { evidenceQuery } = buildEvidenceQuery({
      category: "technical",
      coreThesis: "Some thesis.",
      tone: "analytical",
      authorProfile: { isTechnical: true, seniority: "ic" },
      postQuestions: [
        { text: "Should I use Kafka?", decision: "omit", reason: "rhetorical" },
        { text: "How do I add durability?", decision: "answer", reason: "direct ask" },
      ],
      unspokenTradeoffs: [],
      riskFlags: [],
      pivotStrategy: { acknowledgedPoint: "", insightDirection: "" },
      responseParameters: { technicalDepth: "high", suggestedLength: "standard" },
    });

    assert.doesNotMatch(evidenceQuery, /Kafka/);
    assert.match(evidenceQuery, /How do I add durability/);
  });
});
