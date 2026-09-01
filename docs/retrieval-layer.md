# Retrieval Layer — Embeddings, Index, and Query-Time Search

This document describes how Linkrowth **stores** distilled experience as vectors and **retrieves** relevant proof points when drafting a comment on a LinkedIn post.

For how artifacts are produced offline, see [`distillation.md`](./distillation.md).

---

## Overview

```text
OFFLINE (distill/)
  artifacts.json
        ↓ retrievalText() per artifact
        ↓ embed() — RETRIEVAL_DOCUMENT (Gemini) or standard embed (OpenAI)
        ↓ Float32 vectors + artifact JSON
  experience-index.db (SQLite)

ONLINE (agent/)
  post.text
        ↓ buildRetrievalQuery() → { situationQuery, headline }
        ↓ embedQuery(situationQuery) — RETRIEVAL_QUERY (Gemini) or same embed API (OpenAI)
        ↓ query vector
        ↓ cosineSimilarity() vs every stored vector (brute force)
        ↓ rank, filter, top-k
        ↓ claimableLines → UserContext.proofPoints
        ↓ engage(post, enrichedContext)
```

The engage core (`engage(post, context)`) never touches embeddings. Retrieval is a **context enrichment layer** wired in at `runEngage` time.

---

## Package boundaries

| Package | Role |
|---|---|
| `distill/` | Build the index offline (`npm run index`) |
| `agent/` | Load index + search at query time (`retrieveContext`) |
| `api/` | Runs agent worker; inherits agent env for retrieval |

The agent **never imports** `distill/`. It reads a SQLite file and mirrors types in `agent/src/context/experience/types.ts`.

Default index path:

```text
distill/data/experience-index.db
```

Override: `LINKROWTH_EXPERIENCE_INDEX_DB=/absolute/path/to/experience-index.db`

---

## What gets embedded

Artifacts are **not** embedded as JSON. A deterministic plain-text string is built from selected fields.

`retrievalText()` — defined in both:

- `distill/src/index/vector.ts` (index time)
- `agent/src/context/experience/vector.ts` (mirrored for alignment)

```ts
function retrievalText(artifact: ExperienceArtifact): string {
  return [
    artifact.title,
    artifact.domains.join(", "),
    artifact.stack.join(", "),
    artifact.problem,
    artifact.approach,
    artifact.tradeoff,
    artifact.claimableLine,
    artifact.paths.slice(0, 24).join("\n"),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
```

**Included:** title, domains, stack, problem, approach, tradeoff, claimableLine, up to 24 paths.

**Excluded from embedding:** `id`, `source`, `repo`, `implementationDate`, `confidence`, `shareability`, and any JSON structure.

Example string sent to the embedding model:

```text
Replaced deprecated queue library with Redis Streams
multi-step-agents, background-jobs, reliability
Node.js, Redis, TypeScript
Old job queue was dropping tasks silently under load.
Replaced BullMQ with Redis Streams for durability guarantees.
Higher operational complexity but zero message loss.
We replaced a failing job queue with Redis Streams, eliminating silent drops.
src/workers/queue.ts
src/workers/processor.ts
```

---

## Embedding models

Configured via `LINKROWTH_PROVIDER` and provider-specific embed model env vars.

| Provider | Default embed model | Env override |
|---|---|---|
| `openai` | `text-embedding-3-small` | `LINKROWTH_OPENAI_EMBED_MODEL` |
| `gemini` | `gemini-embedding-001` | `LINKROWTH_GEMINI_EMBED_MODEL` |

Entry points:

- `distill/src/llm/index.ts` — offline `embed()` and `embedQuery()`
- `agent/src/llm/index.ts` — online `embedQuery()` only (index built offline)

### OpenAI

- Index and query both use `embeddings.create()` with `encoding_format: "float"`
- **No** separate document vs query task type — same API path for both

### Gemini (asymmetric retrieval)

| Phase | Function | `taskType` |
|---|---|---|
| Index (`npm run index`) | `embed()` | `RETRIEVAL_DOCUMENT` |
| Query (agent runtime) | `embedQuery()` | `RETRIEVAL_QUERY` |

Using `embed()` at query time with Gemini will produce systematically worse scores because the task-type asymmetry is lost.

---

## Indexing (offline)

**Command:** `cd distill && npm run index`

**Flow** (`distill/src/index/run.ts` → `distill/src/index/store.ts`):

1. Load `data/artifacts.json`
2. Batch artifacts in groups of **32** (`EMBED_BATCH`)
3. For each batch: `texts = batch.map(retrievalText)` → `vectors = await embed(texts)`
4. Round each vector to **6 decimal places** (`roundVector` in `distill/src/util/text.ts`)
5. Build in-memory `ExperienceIndex`
6. Persist to SQLite via `saveIndex()`

### SQLite schema

File: `distill/data/experience-index.db`

```sql
CREATE TABLE index_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  indexed_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  vector BLOB NOT NULL,
  artifact_json TEXT NOT NULL
);
```

| Column | Purpose |
|---|---|
| `index_meta` | Single row: which provider/model/dimensions built this index |
| `experiences.id` | Artifact id (same as distill candidate id) |
| `experiences.vector` | Float32 binary blob (`encodeVector` / `decodeVector`) |
| `experiences.artifact_json` | Full artifact for read-back at query time — **not** what was embedded |

**No ANN index.** No pgvector. No HNSW. Vectors are stored as rows; search is in-memory brute force after load.

### Rebuild when

- Artifacts change (`npm run distill` produced new/changed rows)
- Provider or embed model changes
- You see provider mismatch warnings at query time

---

## Query construction

When a post is processed, retrieval builds a **situation query** from the post
body and keeps the author headline as a separate field. Only `situationQuery` is
embedded.

`agent/src/context/queryConstruction.ts` → `buildRetrievalQuery()`:

Default strategy is **Tier A** (deterministic cleaning, no model). Set
`LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION=raw` to restore the previous
headline+body blob for comparison.

| Input | `situationQuery` | `headline` |
|---|---|---|
| Headline + body | Cleaned body (headline **not** prepended) | Author headline |
| Body only | Cleaned body | `""` |
| Headline only | `""` → retrieval skipped | Author headline |
| Neither | `""` → retrieval skipped | `""` |
| Body that cleans to empty (hashtag-only, etc.) | Trimmed raw body (fallback) | Headline if present |

Tier A cleaning (applied to the body only):

- Strip trailing hashtag walls, `@mentions`, emojis, and trailing CTA lines
  (`Thoughts?`, `follow for more`, …)
- Keep inline hashtag **words** (`#postgres` → `postgres`)
- Collapse whitespace; keep paragraph structure

The constructed query is passed to `embedQuery()`. Headline is recorded on the
retrieval trace (`query.headline`) for a later lexical/BM25 or tie-break
channel and is never mixed into the situation vector.

Traces also record `params.queryConstruction`: `{ tier, fallback, rawLength,
constructedLength }`.

**Note:** Query text is **not** passed through `retrievalText()`. That function is index-side only. Alignment comes from embedding model semantics (similar text → similar vectors), not from identical string formatting.

---

## Scoring: cosine similarity

Search uses **only cosine similarity**. There is no BM25, hybrid score, or LLM re-ranker.

### Formula

Implemented identically in `distill/src/index/vector.ts` and `agent/src/context/experience/vector.ts`:

```text
score = dot(a, b) / (|a| × |b|)
```

Where `a` = query vector, `b` = stored artifact vector.

- Range: **[-1, 1]**
- **1** = same direction (maximally similar)
- **0** = orthogonal (unrelated)
- **-1** = opposite direction

In practice, semantically related content usually scores roughly **0.3–0.9**.

### Dimension guard

If `queryVector.length !== item.vector.length`, `cosineSimilarity` returns **0** immediately. This is the silent failure mode when the index was built with a different model (different dimensions) than the active query provider.

### Ranking algorithm

`rankIndex()` in `agent/src/context/experience/store.ts` (mirrored in `distill/src/index/store.ts`):

```text
1. Map every index item → { score: cosineSimilarity(query, item.vector), artifact }
2. Sort descending by score
3. slice(0, k)
```

**No approximate nearest neighbor.** Every row is scored. Acceptable while artifact counts are small (hundreds/low thousands).

At agent runtime, `retrieveContext` requests **`k × 3`** hits before filtering so enough survive the post-rank filters:

```ts
const rawHits = rankIndex(index, queryVector, Math.max(k * 3, k));
```

Default `k = 5` (`LINKROWTH_RETRIEVAL_K`).

---

## Post-rank filters

After cosine ranking, `selectClaimableHits()` in `agent/src/context/experience/select.ts` applies four filters **in order**:

| # | Filter | Drops | Configurable? |
|---|---|---|---|
| 1 | Shareability | `private` | No — hardcoded |
| 2 | Confidence | `low` | No — hardcoded |
| 3 | Score floor | `score < minScore` | Yes — default **0.3** |
| 4 | Claimable line | empty / whitespace | No — hardcoded |

Then `slice(0, k)` takes the top survivors.

Env: `LINKROWTH_RETRIEVAL_MIN_SCORE=0.3`

### Why the score floor exists

Comment from `select.ts`: *"irrelevant hits are actively harmful"*. Low-similarity artifacts injected as proof points can cause the drafter to claim experience that doesn't match the post.

---

## End-to-end query flow

`agent/src/persistence/runEngage.ts`:

```text
1. loadUserContext()           → static persona from config/user.json
2. retrieveContext(post, base)  → enrich proofPoints from index
3. engage(post, enrichedContext)
```

`retrieveContext()` steps:

```text
1. buildRetrievalQuery(post) → { situationQuery, headline }
   → empty situationQuery? return baseContext unchanged

2. loadIndex(indexPath)
   → missing / empty? return baseContext unchanged

3. warnProviderMismatch(index)   // if index provider ≠ active provider

4. queryVector = await embedQuery(situationQuery)
   → failure? log warning, return baseContext unchanged

5. rawHits = rankIndex(index, queryVector, k * 3)

6. selected = selectClaimableHits(rawHits, { minScore, k })

7. mergeProofPoints(baseContext.proofPoints, claimableLines)
   → return enriched UserContext
```

**Graceful degradation:** missing index, empty query, embed failure, or zero survivors after filtering all return the static context unchanged. The agent still runs; it just has no retrieved proof points.

Callers that pass `context` explicitly (tests, overrides) **skip retrieval entirely**.

---

## Manual search (debug CLI)

Distill includes a search CLI that exercises the same embed + rank path without the agent filters:

```bash
cd distill
npm run search -- "postgres background jobs reliability"
```

`distill/src/index/searchCli.ts`:

1. Load `experience-index.db`
2. Warn on provider mismatch
3. `embedQuery(query)`
4. `rankIndex(index, vector, SEARCH_K)` — default `SEARCH_K=5`
5. Print title, score, repo, shareability, confidence, claimableLine, domains

**Difference from agent:** CLI does **not** run `selectClaimableHits` (no shareability/confidence/minScore filters). Use it to inspect raw cosine scores.

---

## Environment variables (retrieval)

| Variable | Default | Purpose |
|---|---|---|
| `LINKROWTH_PROVIDER` | `openai` | Active LLM + embed provider |
| `LINKROWTH_OPENAI_EMBED_MODEL` | `text-embedding-3-small` | OpenAI embed model |
| `LINKROWTH_GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Gemini embed model |
| `LINKROWTH_EXPERIENCE_INDEX_DB` | `../distill/data/experience-index.db` | Index file path (agent) |
| `LINKROWTH_RETRIEVAL_K` | `5` | Max proof points after filtering |
| `LINKROWTH_RETRIEVAL_MIN_SCORE` | `0.3` | Cosine score floor |
| `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION` | `a` | Query construction: `a` (Tier A cleaning) or `raw` (headline+body blob) |
| `SEARCH_K` | `5` | Top hits for `npm run search` (distill CLI) |

Also required: the matching provider API key (`OPENAI_API_KEY` or `GEMINI_API_KEY`).

---

## Debugging retrieval

### Symptom → likely cause

| Symptom | Check |
|---|---|
| All scores `0.000` | Dimension mismatch — index model ≠ query model. Inspect `index_meta` in SQLite vs env vars. Rebuild index. |
| Scores exist but nothing injected | All hits filtered out — raise `LINKROWTH_RETRIEVAL_MIN_SCORE` temporarily, or check `shareability`/`confidence` on artifacts |
| Provider mismatch warning in logs | Index built with different `LINKROWTH_PROVIDER` than agent — rebuild `npm run index` |
| `retrieval injected 0 proof point(s)` | Empty query, missing index, embed failure, or filters removed all hits — check logs for `[retrieveContext]` |
| Good CLI scores, bad agent results | Agent filters (`minScore`, shareability, confidence) — CLI skips these |
| Gemini scores worse after config change | Confirm query uses `embedQuery()` (RETRIEVAL_QUERY), not `embed()` |

### Inspect index metadata

```bash
sqlite3 distill/data/experience-index.db \
  "SELECT indexed_at, provider, model, dimensions, count FROM index_meta;"
```

### Verify embed alignment

1. Pick an artifact from `artifacts.json`
2. Manually build its `retrievalText()` string
3. `npm run search -- "<text from a related LinkedIn post>"`
4. Confirm expected artifact ranks high with score ≥ `0.3`

---

## Key source files

| File | Role |
|---|---|
| **Offline index** | |
| `distill/src/index/run.ts` | `npm run index` entry |
| `distill/src/index/store.ts` | `buildIndex`, `saveIndex`, `loadIndex`, `rankIndex` |
| `distill/src/index/vector.ts` | `retrievalText`, `cosineSimilarity` |
| `distill/src/index/searchCli.ts` | `npm run search` debug CLI |
| `distill/src/llm/index.ts` | `embed()`, `embedQuery()` |
| **Online retrieval** | |
| `agent/src/context/retrieveContext.ts` | Query embed, rank, merge proof points |
| `agent/src/context/queryConstruction.ts` | Tier A `buildRetrievalQuery()` (situation vs headline) |
| `agent/src/context/experience/store.ts` | Load SQLite, `rankIndex` |
| `agent/src/context/experience/vector.ts` | `cosineSimilarity`, mirrored `retrievalText` |
| `agent/src/context/experience/select.ts` | Shareability/confidence/score filters |
| `agent/src/persistence/runEngage.ts` | Wires `loadUserContext` + `retrieveContext` |
| **Tests** | |
| `distill/src/index/vector.test.ts` | Cosine + ranking unit tests |
| `agent/src/context/experience/store.test.ts` | Store + cosine tests |
| `agent/src/context/retrieveContext.test.ts` | End-to-end retrieval behavior |
| `agent/src/context/queryConstruction.test.ts` | Tier A query cleaning |

---

## Related docs

- [`distillation.md`](./distillation.md) — offline LLM artifact production
- [`retrieval-matching-design.md`](./retrieval-matching-design.md) — review of the current cosine baseline and proposed schema-aware hybrid matching
- [`retrieval-query-construction.md`](./retrieval-query-construction.md) — query-side design: how a post becomes the embedded query
- [`distill/README.md`](../distill/README.md) — setup and commands
