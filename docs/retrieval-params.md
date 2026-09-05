# Retrieval Parameters

Reference for every knob that affects the retrieval pipeline: environment
variables, programmatic overrides, hardcoded filters, and typical configurations.

For pipeline behavior and architecture, see:

- [`retrieval-layer.md`](./retrieval-layer.md) — embeddings, index, cosine search
- [`retrieval-query-construction.md`](./retrieval-query-construction.md) — query tiers and evidence query
- [`retrieval-matching-design.md`](./retrieval-matching-design.md) — phased rollout design

---

## Production defaults

These are the effective defaults when no overrides are set:

```bash
LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=a
LINKROWTH_RETRIEVAL_STRATEGY=single
LINKROWTH_RETRIEVAL_K=5
LINKROWTH_RETRIEVAL_MIN_SCORE=0.3
```

Query time embeds the **Tier A cleaned post body** and ranks against the
**combined artifact vector** (`retrievalText`). Headline is traced but never
embedded.

---

## Environment variables

### Query construction

| Variable | Default | Values | Effect |
| --- | --- | --- | --- |
| `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION` | `a` | `a`, `1` → Tier A<br>`raw`, `baseline`, `0` → pre-Tier-A blob | Controls `buildRetrievalQuery()`. Tier A embeds cleaned post body only; headline stays in the trace, not in the embedded text. `raw` restores `"Author headline: …\n\n{body}"` for A/B comparison. |

### Ranking strategy

| Variable | Default | Values | Effect |
| --- | --- | --- | --- |
| `LINKROWTH_RETRIEVAL_STRATEGY` | `single` | `single` → combined `vector`<br>`split`, `2` → `situation_vector`<br>`hybrid`, `3` → situation cosine + BM25 + RRF | Candidate-generation strategy. |
| `LINKROWTH_RETRIEVAL_K` | `5` | positive integer | Max proof points injected **after** post-rank filters. |
| `LINKROWTH_RETRIEVAL_MIN_SCORE` | `0.3` | float | Cosine floor for single/split and the semantic admission floor for hybrid. Hybrid candidates also pass admission when BM25 recovered them. |
| `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | `k × 4` | positive integer | Eligible-artifact pool for single/split and hybrid's semantic channel. |
| `LINKROWTH_RETRIEVAL_LEXICAL_POOL` | `k × 4` | positive integer | Eligible-artifact BM25 pool for hybrid. |
| `LINKROWTH_RETRIEVAL_RRF_C` | `60` | positive integer | RRF rank constant for hybrid ordering. |

**Effective pool sizes:**

| Strategy | Pool | Source |
| --- | --- | --- |
| `single` | `max(candidatePoolSize, k)` | `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` or `k × 4` |
| `split` | `max(candidatePoolSize, k)` | same |
| `hybrid` semantic | `max(candidatePoolSize, k)` | same |
| `hybrid` lexical | `lexicalPoolSize` | `LINKROWTH_RETRIEVAL_LEXICAL_POOL` or `k × 4` |

### Index and embedding

| Variable | Default | Effect |
| --- | --- | --- |
| `LINKROWTH_EXPERIENCE_INDEX_DB` | `../distill/data/experience-index.db` (relative to agent root) | Path to the SQLite experience index. **Schema v3 required** — older indexes are rejected and retrieval falls back to static context. |
| `LINKROWTH_PROVIDER` | `openai` | Active LLM provider for query embedding: `openai` or `gemini`. Must match the provider used when the index was built. |
| `LINKROWTH_OPENAI_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embedding model for `embedQuery()` at retrieval time. |
| `LINKROWTH_GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Gemini embedding model for `embedQuery()` at retrieval time. |
| `OPENAI_API_KEY` | — | Required when `LINKROWTH_PROVIDER=openai`. |
| `GEMINI_API_KEY` | — | Required when `LINKROWTH_PROVIDER=gemini`. |

The same provider and embed-model vars are used when **building** the index
offline (`cd distill && npm run index`). Mismatch between index metadata and
active query provider produces a log warning and unreliable scores.

### Trace persistence

| Variable | Default | Values | Effect |
| --- | --- | --- | --- |
| `LINKROWTH_RETRIEVAL_TRACE` | off | `1`, `true`, `yes`, `on` → Postgres sink | When enabled, persists retrieval traces to the `retrieval_traces` table. Unset or falsey → no-op (retrieval still runs). |
| `DATABASE_URL` | — | Postgres connection string | Required when trace persistence is enabled. |

---

## Programmatic overrides

`retrieveContext(post, baseContext, options)` accepts overrides that take
precedence over environment variables. Used in tests and eval harnesses; not
wired through `runEngageWithStatus` today.

| Option | Type | Env equivalent | Effect |
| --- | --- | --- | --- |
| `queryConstruction` | `"raw"` \| `"a"` | `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION` | Query construction tier. |
| `strategy` | `"single"` \| `"split"` \| `"hybrid"` | `LINKROWTH_RETRIEVAL_STRATEGY` | Retrieval strategy. |
| `k` | `number` | `LINKROWTH_RETRIEVAL_K` | Max hits after filtering. |
| `minScore` | `number` | `LINKROWTH_RETRIEVAL_MIN_SCORE` | Cosine score floor. |
| `candidatePoolSize` | `number` | `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | Recall pool for all strategies (Phase 1). |
| `lexicalPoolSize` | `number` | `LINKROWTH_RETRIEVAL_LEXICAL_POOL` | Hybrid BM25 pool. |
| `rrfC` | `number` | `LINKROWTH_RETRIEVAL_RRF_C` | Hybrid RRF constant. |
| `indexPath` | `string` | `LINKROWTH_EXPERIENCE_INDEX_DB` | Override index file path. |
| `analysis` | `AnalysisArtifact` | — | **Split only.** Enables evidence-cosine trace annotation via `buildEvidenceQuery()`. Does not affect selection in Phase 2. |
| `embedQuery` | function | — | Test double for embedding. |
| `loadIndex` | function | — | Test double for index load. |
| `lexicalSearch` | function | — | Test double for BM25 search. |
| `traceSink` | `RetrievalTraceSink` | — | Custom trace sink (e.g. in-memory capture). |

**Skipping retrieval entirely:** pass `context` to `runEngageWithStatus()` —
retrieval is bypassed and the supplied context is used as-is.

---

## Hardcoded filters

Eligibility (shareability, confidence, non-empty `claimableLine`) is applied
**before** candidate pool caps via `buildCandidateWindow()` in
`agent/src/context/experience/select.ts` (Phase 1). Semantic and lexical
rankers scan ordered results until the configured number of injectable
artifacts is found or the ranking is exhausted. Rejected rows keep their
original channel ranks, scores, and eligibility reasons in the trace.

Lexical ranking consumes all ordered FTS matches under the current small-index
assumption; it does not use an over-fetch multiplier.

The same eligibility checks run again in `evaluateHits()` as defense in depth,
together with score floor and top-k:

| # | Filter | Kept | Dropped (`dropReason`) |
| --- | --- | --- | --- |
| 1 | Shareability | `public`, `anonymized` | `private` → `shareability` |
| 2 | Confidence | `high`, `medium` | `low` → `confidence` |
| 3 | Claimable line | non-empty trimmed text | empty → `empty_claim` |
| 4 | Relevance | single/split cosine clears `minScore`; hybrid clears it semantically or has a lexical rank | otherwise `min_score` |
| 5 | Top-k cap | first `k` survivors | rest → `over_k` |

---

## Distill / offline index build

Same embedding provider vars apply at index-build time:

| Variable | Default | Effect |
| --- | --- | --- |
| `LINKROWTH_PROVIDER` | `openai` | Provider for document embedding (`RETRIEVAL_DOCUMENT` task on Gemini). |
| `LINKROWTH_OPENAI_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embed model at index time. |
| `LINKROWTH_GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Gemini embed model at index time. |

Each artifact is embedded as three vectors: combined (`retrievalText`),
situation (`situationText`), and evidence (`evidenceText`). Index schema
version is `3` (`EXPERIENCE_INDEX_SCHEMA_VERSION`) and includes the
`experiences_fts` BM25 index.

### Distill search CLI

| Variable | Default | Effect |
| --- | --- | --- |
| `SEARCH_K` | `5` | Top hits printed by `npm run search -- "query"` in `distill/`. Does not apply shareability, confidence, or min-score filters. |

---

## Trace payload (`params`)

When traces are recorded, active knobs appear in `RetrievalTrace.params`:

```jsonc
{
  "k": 5,
  "minScore": 0.3,
  "strategy": "single",
  "queryConstruction": {
    "tier": "a",
    "fallback": false,
    "rawLength": 142,
    "constructedLength": 118
  },
  "candidatePoolSize": 20
}
```

Hybrid traces additionally record `semanticPoolSize`, `lexicalPoolSize`,
`rrfC`, `bm25Weights`, `hybridAdmission`, and `lexicalChannel`. The last field
distinguishes a valid zero-hit BM25 search from a skipped or failed search and
records situation-only fallback.

Query text fields on the trace:

| Field | Source |
| --- | --- |
| `query.text` | Embedded `situationQuery` |
| `query.headline` | Author headline (never embedded) |
| `query.evidenceText` | `buildEvidenceQuery()` output — split strategy only, when `analysis` is available |

Trace schema version: `RETRIEVAL_TRACE_SCHEMA_VERSION = 3`.

---

## Example configurations

### Production (current)

```bash
LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=a
LINKROWTH_RETRIEVAL_STRATEGY=single
LINKROWTH_RETRIEVAL_K=5
LINKROWTH_RETRIEVAL_MIN_SCORE=0.3
# LINKROWTH_EXPERIENCE_INDEX_DB=   # default: ../distill/data/experience-index.db
```

### Phase 2 split evaluation

Requires a schema-v3 index rebuild (`cd distill && npm run index`).

```bash
LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=a
LINKROWTH_RETRIEVAL_STRATEGY=split
LINKROWTH_RETRIEVAL_K=5
LINKROWTH_RETRIEVAL_MIN_SCORE=0.3
LINKROWTH_RETRIEVAL_CANDIDATE_POOL=20   # optional; default k×4 = 20 when k=5
```

Selection behavior is unchanged from `single` in Phase 2; split adds
`situationScore` / `evidenceScore` to traces when analysis is supplied.

### Phase 3 hybrid evaluation

```bash
LINKROWTH_RETRIEVAL_STRATEGY=hybrid
LINKROWTH_RETRIEVAL_K=5
LINKROWTH_RETRIEVAL_MIN_SCORE=0.3
LINKROWTH_RETRIEVAL_CANDIDATE_POOL=20
LINKROWTH_RETRIEVAL_LEXICAL_POOL=20
LINKROWTH_RETRIEVAL_RRF_C=60
```

The lexical query is a bounded OR expression of parser-safe meaningful terms.
RRF orders candidates; semantic-floor or lexical-match admission controls
abstention.

### Pre–Tier A baseline (A/B)

```bash
LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=raw
LINKROWTH_RETRIEVAL_STRATEGY=single
LINKROWTH_RETRIEVAL_K=5
LINKROWTH_RETRIEVAL_MIN_SCORE=0.3
```

### With trace persistence

```bash
LINKROWTH_RETRIEVAL_TRACE=1
DATABASE_URL=postgresql://linkrowth:linkrowth@localhost:5432/linkrowth
```

---

## Key source files

| File | Role |
| --- | --- |
| `agent/src/context/retrieveContext.ts` | Orchestrates retrieval; reads env vars |
| `agent/src/context/queryConstruction.ts` | Query construction tiers |
| `agent/src/context/experience/select.ts` | Post-rank eligibility filters |
| `agent/src/context/experience/store.ts` | Index load, `rankIndex`, `rankBySituation` |
| `agent/src/persistence/retrievalTrace/repository.ts` | `LINKROWTH_RETRIEVAL_TRACE` sink selection |
| `agent/src/persistence/runEngage.ts` | Wires retrieval into the engage pipeline |
| `distill/src/index/store.ts` | Offline index build |
| `agent/.env.example` | Example env block for agent retrieval vars |
