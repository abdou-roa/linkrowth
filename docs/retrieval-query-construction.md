# Retrieval Query Construction

This document describes how a LinkedIn post becomes the embedded query at
retrieval time, and how a completed `AnalysisArtifact` is mapped to an
evidence-channel query for offline evaluation and future evidence scoring.

For the retrieval layer as a whole — embeddings, SQLite schema, candidate
generation, and post-rank filters — see [`retrieval-layer.md`](./retrieval-layer.md).
For the matching design and proposed phases, see
[`retrieval-matching-design.md`](./retrieval-matching-design.md).

---

## Overview

Query construction is deterministic and synchronous. No LLM call is made to
derive the query; the result is inspectable, reproducible, and version-tagged
in retrieval traces.

Two entry points in `agent/src/context/queryConstruction.ts`:

| Function | Input | Output | When |
| --- | --- | --- | --- |
| `buildRetrievalQuery(post)` | `Post` | `RetrievalQuery` | At retrieval time, before the situation embed |
| `buildEvidenceQuery(analysis)` | `AnalysisArtifact` | `EvidenceQuery` | In Phase 2: offline eval + trace annotation; in Phase 4: production evidence scoring after analysis |

---

## `buildRetrievalQuery(post)` — Tier A

Produces the `situationQuery` string that is embedded and cosine-matched against
situation vectors. The author headline is kept as a separate field and is **never
mixed into the embedded query text**.

### Construction strategy tiers

| Tier | Env value | Behavior |
| --- | --- | --- |
| `a` (default) | `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=a` | Clean the post body (strip boilerplate, decode hashtags) |
| `raw` | `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=raw` | Pre-Tier-A blob: `"Author headline: …\n\n{body}"` |

### Tier A cleaning (`cleanSituationText`)

Applied to the post body only:

- Strip trailing hashtag walls and `@mentions`
- Remove emojis
- Strip trailing CTA lines (`Thoughts?`, `Follow for more`, …)
- Decode inline hashtags — `#postgres` → `postgres`
- Collapse whitespace; preserve paragraph breaks
- Fallback: if cleaning yields nothing, use the trimmed raw body (`fallback: true`)

### Query output shape

```ts
interface RetrievalQuery {
  situationQuery: string;   // embedded text
  headline: string;         // author headline — never embedded
  tier: QueryConstructionTier;
  fallback: boolean;
  rawLength: number;
  constructedLength: number;
}
```

### Routing table

| Post content | `situationQuery` | `headline` | Notes |
| --- | --- | --- | --- |
| Headline + body | Cleaned body | Author headline | Standard case |
| Body only | Cleaned body | `""` | |
| Headline only | `""` → retrieval skipped | Author headline | Recorded on trace |
| Neither | `""` → retrieval skipped | `""` | |
| Body that cleans to empty | Trimmed raw body | Headline if present | `fallback: true` |

---

## `buildEvidenceQuery(analysis)` — analysis-derived evidence query

Maps a completed `AnalysisArtifact` to a deterministic text string for
comparison against artifact **evidence vectors** (approach + tradeoff + claimableLine).

The query captures the *intended response* the agent plans to make, not the
raw post. This is the correct signal for evidence scoring: an artifact's
evidence should support what the agent is going to say, not merely describe the
same situation as the post.

### Field mapping

| `AnalysisArtifact` field | Included when | Represents |
| --- | --- | --- |
| `coreThesis` | non-empty | The central claim the agent will make |
| `pivotStrategy.insightDirection` | non-empty | Specific angle the response will take |
| `pivotStrategy.acknowledgedPoint` | non-empty | Point being conceded before the pivot |
| `postQuestions[].text` | `decision === "answer"` | Questions the agent is obligated to address |
| `unspokenTradeoffs[]` | non-empty items | Trade-offs the response must address |

`omit`-classified questions are excluded — they are rhetorical or stylistic and
do not drive the evidence need.

### Output shape

```ts
interface EvidenceQuery {
  evidenceQuery: string;        // assembled text (empty when no signals)
  provenance: EvidenceQueryProvenance;
  constructedLength: number;
}

interface EvidenceQueryProvenance {
  hasCoreThesis: boolean;
  hasInsightDirection: boolean;
  hasAcknowledgedPoint: boolean;
  answerableQuestionCount: number;
  unspokenTradeoffCount: number;
}
```

### Phase 2 position

In Phase 2, `buildEvidenceQuery` is defined and tested but is **not** used to
gate production selection. It is:

- Used in the offline evaluation harness (`npm run eval`) to measure
  evidence-cosine separation between applicable and non-applicable artifacts.
- Called in `retrieveContext` when `strategy=split` and `analysis` is passed in
  `RetrieveContextOptions` — the resulting `evidenceScore` is annotated on
  each `RetrievalTraceHit` and `query.evidenceText` is recorded in the trace.
- Not called in the production pipeline today because analysis runs *after*
  retrieval. Phase 4 will split the pipeline and wire it into production
  evidence scoring.

---

## Retrieval strategy and query interplay

The `LINKROWTH_RETRIEVAL_STRATEGY` env var controls which vector column is used
for candidate ranking:

| Strategy | Query embedded | Index column used | Phase |
| --- | --- | --- | --- |
| `single` (default) | `situationQuery` | `vector` (combined retrievalText) | Current baseline |
| `split` | `situationQuery` | `situation_vector` (situationText fields only) | Phase 2 |

The evidence query is embedded separately when available and its cosine is
recorded as a trace annotation in Phase 2; it does not affect which candidates
are injected.

---

## Trace fields

Both `buildRetrievalQuery` and `buildEvidenceQuery` provenance is recorded in
the retrieval trace (`RetrievalTrace`):

```jsonc
{
  "query": {
    "text": "<situationQuery>",
    "headline": "<author headline or omitted>",
    "evidenceText": "<evidenceQuery — split strategy only, when analysis available>"
  },
  "params": {
    "queryConstruction": {
      "tier": "a",
      "fallback": false,
      "rawLength": 142,
      "constructedLength": 118
    },
    "strategy": "single",
    "candidatePoolSize": 20
  }
}
```

---

## Environment variables

See [`retrieval-params.md`](./retrieval-params.md) for the full parameter
reference including ranking, index, and trace knobs.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION` | `a` | `a` (Tier A cleaning) or `raw` (headline+body blob baseline) |
| `LINKROWTH_RETRIEVAL_STRATEGY` | `single` | `single` (combined vector) or `split` (situation vector + evidence annotation) |
| `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | `k * 4` | Situation-channel recall pool size (split strategy only) |

---

## Key source files

| File | Role |
| --- | --- |
| `agent/src/context/queryConstruction.ts` | `buildRetrievalQuery`, `cleanSituationText`, `buildEvidenceQuery` |
| `agent/src/context/retrieveContext.ts` | Embeds `situationQuery`; calls `buildEvidenceQuery` for trace annotation (split) |
| `agent/src/context/queryConstruction.test.ts` | Unit tests for Tier A cleaning and evidence query assembly |
