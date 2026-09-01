# Phase 3 Plan — Lexical Retrieval and RRF Fusion

This is the implementation plan for **Phase 3** of the retrieval-matching rollout
defined in [`retrieval-matching-design.md`](./retrieval-matching-design.md).
It builds directly on Phase 2's split semantic vectors and adds a BM25 lexical
channel, then fuses both rank lists with Reciprocal Rank Fusion (RRF).

Phase 3 scope, verbatim from the design:

- create the FTS5 lexical index; ✅
- retrieve semantic and BM25 candidate lists; ✅
- fuse ranks with RRF; ✅
- tune candidate counts and the RRF constant on the labeled set. ⬜

**Status: implementation complete; evaluation/tuning pending.** The hybrid
pipeline ships behind `LINKROWTH_RETRIEVAL_STRATEGY=hybrid` (default remains
`single`). Tuning RRF constant and pool sizes on the labeled set is deferred.

**Guiding constraint:** Phase 3 changes *how candidates are generated*, but must
**not** change production selection until the labeled comparison justifies it.

---

## Prerequisites and dependencies

| Dependency | State | Needed because |
| --- | --- | --- |
| Phase 2 split vectors (`schema_version=2`) | Landed | The `hybrid` strategy reuses `rankBySituation` for the semantic channel. |
| Phase 2 trace v2 | Landed | Phase 3 extends the trace schema to v3. |
| Labeled evaluation set (design Phase 0) | **Not in repo** | Step 4 (tuning) needs labeled post↔artifact triples. Phase 2 eval scaffold exists but dataset is empty. |
| Phase 1 eligibility prefilter | Not landed | Not a blocker — `evaluateHits()` already runs as post-rank filter. The design notes Phase 1 as parallel. |

Phase 3 can be built against the existing v2 index first (FTS5 is additive to the
distill build) and the schema bumped to v3 when the FTS5 table is ready.

---

## Design decisions

### D1. FTS5 lexical index — same SQLite file, schema v3

The experience index is already SQLite. Adding an FTS5 virtual table to the same
file keeps the deployment simple: one file, one version, one rebuild.

**Schema bump:** `EXPERIENCE_INDEX_SCHEMA_VERSION = 3` (distill + agent). All
three strategies (`single`, `split`, `hybrid`) require a v3 index after the bump.
A v2 index produces a `no_index` outcome and static fallback — no silent
mis-scoring.

**FTS5 table definition with separate columns:**

```sql
CREATE VIRTUAL TABLE experiences_fts USING fts5(
  id   UNINDEXED,   -- artifact ID, stored not indexed
  title,
  domains,
  stack,
  problem,
  approach,
  paths,
  tokenize = 'unicode61'
);
```

Separate columns allow per-column BM25 weight adjustments via the `bm25()`
function. `paths` get a lower default weight so path tokens do not dominate
title/problem matches (design requirement).

Default BM25 column weights (tunable in step 4):

| Column | Weight |
| --- | --- |
| `title` | 3.0 |
| `domains` | 2.0 |
| `stack` | 2.0 |
| `problem` | 2.0 |
| `approach` | 1.5 |
| `paths` | 0.5 |

Weights are recorded in retrieval traces so they are auditable per run.

### D2. Lexical document content

The FTS5 document is assembled from the same artifact fields as `situationText()`
and `retrievalText()`, **plus** approach. The split:

| Channel | Fields |
| --- | --- |
| FTS5 title column | `artifact.title` |
| FTS5 domains column | `artifact.domains.join(", ")` |
| FTS5 stack column | `artifact.stack.join(", ")` |
| FTS5 problem column | `artifact.problem` |
| FTS5 approach column | `artifact.approach` |
| FTS5 paths column | `artifact.paths.slice(0, 24).join(" ")` |

`tradeoff` and `claimableLine` are intentionally excluded — they are in the
evidence vector, which is a Phase 4 reranking signal, not a candidate-generation
signal. `paths` are included here because they carry exact lexical signals
(filename stems, package names) that the embedding may underweight.

### D3. Lexical query from the situation query

The BM25 query uses the same `situationQuery` text that feeds the semantic embed
(`buildRetrievalQuery(post).situationQuery`). No second cleaning pass is needed.

The raw text must be sanitized for FTS5 special characters before passing to
`MATCH`. A helper `buildFts5Query(text)` strips FTS5 operators and quotes, then
returns a term-based query (space-separated tokens, no phrase grouping). Phrase
matching can be revisited if recall suffers.

```ts
export function buildFts5Query(text: string): string {
  // Strip FTS5 special characters: " ^ * ( ) [ ] { } : OR AND NOT
  return text
    .replace(/["^*()\[\]{}:]/g, " ")
    .replace(/\b(OR|AND|NOT)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Returns `""` on empty input; `rankByLexical` skips the FTS query and returns `[]`.

### D4. RRF fusion

RRF combines rank positions from the two lists, **not** raw scores.
BM25 and cosine values are not comparable (different scales, different signs) and
must never be directly summed:

```text
rrf(candidate) =
  1 / (c + semanticRank)   -- 0 if candidate not in semantic list
  + 1 / (c + lexicalRank)  -- 0 if candidate not in lexical list
```

Where `semanticRank` and `lexicalRank` are 1-indexed positions in their
respective sorted lists. A candidate present in only one list contributes only
that channel's term — it can still survive, preserving recall.

The rank constant `c` (default **60**, from the original RRF paper) is
configured by `LINKROWTH_RETRIEVAL_RRF_C` and recorded in traces. It must be
selected by benchmark results, not intuition.

### D5. Post-fusion selection

After RRF, fused candidates are sorted by `rrfScore` descending and passed
through `evaluateHits()` for safety + top-k selection. For `hybrid`, the
`minScore` cosine floor does **not** apply — RRF scores are not cosine values.
`evaluateHits()` is called with `minScore = 0` for the hybrid path. The
shareability, confidence, and empty-claim filters remain hard constraints.

A post-RRF score threshold is future tuning work (Phase 4+, with labeled data).

### D6. Strategy flag extension

`LINKROWTH_RETRIEVAL_STRATEGY` gains a `hybrid` value (also accepts `"3"`):

| Value | Behavior |
| --- | --- |
| `single` (default) | Combined vector cosine (v3 index, combined `vector` column) |
| `split` | Situation cosine only (v3 index, `situationVector`) |
| `hybrid` | Situation cosine + BM25 via FTS5, fused with RRF (v3 index) |

Under `hybrid`, if the FTS5 query fails (table missing, SQLite error), retrieval
logs a warning and falls back to the situation-only result — it does **not** fall
back to static context, because the semantic channel already produced candidates.
This preserves recall over aborting.

---

## Current state (what Phase 3 changes)

### What exists (Phase 2)

- `distill/src/index/store.ts` — `buildIndex` / `saveIndex` write three vectors per artifact; schema v2
- `agent/src/context/experience/store.ts` — `loadIndex` reads v2; `rankBySituation` for split
- `agent/src/context/retrieveContext.ts` — `single` and `split` strategies; graceful degradation ladder
- `agent/src/persistence/retrievalTrace/types.ts` — trace v2 with `situationScore` / `evidenceScore`

### What Phase 3 adds

- FTS5 virtual table `experiences_fts` in the same SQLite file; schema v3
- `rankByLexical(dbPath, fts5Query, k, bm25Weights?)` in the agent store
- `buildFts5Query(text)` sanitizer (pure, unit-tested)
- `fuseRRF(semanticHits, lexicalHits, { c })` pure combinator → `FusedCandidate[]`
- `hybrid` path in `retrieveContext`: embed → semantic candidates + BM25 candidates → RRF → `evaluateHits(minScore=0)` → inject
- Trace v3: `lexicalRank`, `bm25Score`, `rrfScore` per hit; `rrfC`, `lexicalPoolSize` in params; `lexicalMs` in timings

---

## Work breakdown

### WB1 — Distill: FTS5 index build ⬜

- `distill/src/types.ts`:
  - Bump `EXPERIENCE_INDEX_SCHEMA_VERSION = 3`.

- `distill/src/index/vector.ts`:
  - Add `lexicalFields(artifact): { title, domains, stack, problem, approach, paths }`.
    Returns the six column strings for FTS5 insert. No embedding — purely lexical.
    `paths` uses `artifact.paths.slice(0, 24).join(" ")`.
  - No change to existing `retrievalText`, `situationText`, `evidenceText`.

- `distill/src/index/store.ts`:
  - Add `experiences_fts` FTS5 virtual table to `SCHEMA` (after `DROP TABLE IF EXISTS
    experiences_fts`).
  - `saveIndex()`: add FTS5 insert transaction — one row per artifact, same
    transaction as vector inserts.
  - `loadIndex()`: `schema_version !== 3` → return `null` (was `!== 2`).

- `distill/src/index/run.ts`: no interface change; rebuild continues as before.

- `distill/src/index/searchCli.ts`: add `--channel lexical` option — calls
  `rankByLexical` (from the distill store or inline SQLite query) and prints hits
  alongside `--channel situation` for debugging.

### WB2 — Agent types ⬜

- `agent/src/context/experience/types.ts`:
  - Bump `EXPERIENCE_INDEX_SCHEMA_VERSION = 3`.
  - Add:
    ```ts
    export interface LexicalRankedArtifact {
      bm25Score: number;   // raw SQLite bm25() value (negative = better)
      artifact: ExperienceArtifact;
    }

    export interface FusedCandidate {
      artifact: ExperienceArtifact;
      rrfScore: number;
      semanticRank?: number;   // 1-indexed; absent if not in semantic list
      lexicalRank?: number;    // 1-indexed; absent if not in lexical list
      situationScore?: number; // cosine from semantic channel
      bm25Score?: number;      // raw bm25() from lexical channel
    }
    ```

- `agent/src/context/retrieveContext.ts`:
  - Extend `RetrievalStrategy = "single" | "split" | "hybrid"`.
  - `parseRetrievalStrategy`: map `"hybrid"` or `"3"` → `"hybrid"`.

### WB3 — Agent store: BM25 + RRF ⬜

New exports in `agent/src/context/experience/store.ts`:

- **`buildFts5Query(text: string): string`** — pure sanitizer (unit-tested):
  strips FTS5 special characters, collapses whitespace, returns term-based query.
  Returns `""` when nothing remains.

- **`rankByLexical(dbPath: string, fts5Query: string, k: number, bm25Weights?: Bm25Weights): LexicalRankedArtifact[]`** —
  opens the index DB (read-only), queries `experiences_fts` with explicit
  per-column `bm25()` weights, closes DB. Returns at most `k` results ordered by
  descending BM25 relevance. Returns `[]` on empty query or FTS error (callers
  decide how to handle).

  Default `Bm25Weights`:
  ```ts
  { title: 3.0, domains: 2.0, stack: 2.0, problem: 2.0, approach: 1.5, paths: 0.5 }
  ```

  FTS5 query:
  ```sql
  SELECT id, bm25(experiences_fts, 0, @title, @domains, @stack, @problem, @approach, @paths) AS score
  FROM experiences_fts
  WHERE experiences_fts MATCH @query
  ORDER BY score        -- bm25() returns negatives; ascending = best match
  LIMIT @k
  ```
  Cross-reference artifact JSON from `experiences` table via `id` to populate
  `LexicalRankedArtifact.artifact`.

- **`fuseRRF(semanticHits: RankedArtifact[], lexicalHits: LexicalRankedArtifact[], options: { c: number }): FusedCandidate[]`** —
  pure function (no I/O, no DB). Combines rank lists per D4 formula. Returns
  candidates sorted by `rrfScore` descending.

### WB4 — Agent: retrieval orchestration ⬜

`agent/src/context/retrieveContext.ts`:

- **New options on `RetrieveContextOptions`:**
  ```ts
  /** RRF rank constant. Default LINKROWTH_RETRIEVAL_RRF_C or 60. */
  rrfC?: number;
  /** BM25 candidate pool size. Default LINKROWTH_RETRIEVAL_LEXICAL_POOL or k * 4. */
  lexicalPoolSize?: number;
  /** Override lexical search (tests). */
  lexicalSearch?: LexicalSearchFn;
  ```
  Where `LexicalSearchFn = (dbPath: string, query: string, k: number) => LexicalRankedArtifact[]`.

- **`hybrid` path in the strategy dispatch:**
  1. Build `fts5Query = buildFts5Query(situationQuery)`.
  2. Embed `situationQuery` → `queryVector` (same as split — one embed call).
  3. `rankBySituation(index, queryVector, semanticPoolSize)` → `semanticHits`.
  4. `rankByLexical(indexPath, fts5Query, lexicalPoolSize)` → `lexicalHits` (or `[]` on failure, with a logged warning).
  5. `fuseRRF(semanticHits, lexicalHits, { c: rrfC })` → `fused`.
  6. `evaluateHits(fused, { minScore: 0, k })` — RRF scores are not cosine; floor is 0.
  7. Inject surviving claimable lines; emit trace.

- **Graceful FTS5 fallback:** if `rankByLexical` throws, log a warning and
  continue with situation-only candidates (step 3 result). Do **not** return
  `baseContext` — semantic retrieval already ran.

- **New params in trace:**
  ```ts
  rrfC, lexicalPoolSize, semanticPoolSize, bm25Weights
  ```

- **New env vars read:**
  - `LINKROWTH_RETRIEVAL_RRF_C` — default 60
  - `LINKROWTH_RETRIEVAL_LEXICAL_POOL` — default `k * 4`
  - `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` continues as semantic pool for `split`
    and `hybrid`.

### WB5 — Traces: v3 ⬜

- `agent/src/persistence/retrievalTrace/types.ts`:
  - Bump `RETRIEVAL_TRACE_SCHEMA_VERSION = 3`.
  - `RetrievalTraceHit`:
    ```ts
    lexicalRank?: number;    // 1-indexed position in BM25 list (hybrid strategy)
    bm25Score?: number;      // raw SQLite bm25() value (negative)
    rrfScore?: number;       // RRF combined score (hybrid strategy)
    ```
  - `RetrievalIndexMeta.schemaVersion` comment: update to mention v3.
  - `RetrievalTrace.timings`: add `lexicalMs?: number`.

- `db/migrations/0005_retrieval_trace_v3.sql`:
  Same pattern as `0004` — document new JSONB fields; no DDL change needed.
  ```
  candidates[].lexicalRank        number | undefined
  candidates[].bm25Score          number | undefined
  candidates[].rrfScore           number | undefined
  params.rrfC                     number (hybrid strategy)
  params.lexicalPoolSize          number (hybrid strategy)
  params.semanticPoolSize         number (hybrid strategy)
  params.bm25Weights              object (hybrid strategy)
  timings.lexicalMs               number | undefined
  ```

### WB6 — Docs ⬜

- `docs/retrieval-layer.md`: add FTS5 schema, lexical document assembly,
  BM25 query structure, RRF formula, new env vars, updated overview flow diagram.
- `docs/retrieval-matching-design.md`: mark Phase 3 in-progress.
- `docs/retrieval-phase-3-plan.md`: this document (the plan itself).

---

## New / changed environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKROWTH_RETRIEVAL_STRATEGY` | `single` | Extended with `hybrid` (Phase 3). |
| `LINKROWTH_RETRIEVAL_RRF_C` | `60` | RRF rank constant. Tune in step 4 via labeled set. |
| `LINKROWTH_RETRIEVAL_LEXICAL_POOL` | `k * 4` | BM25 candidate pool size (hybrid only). |
| `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | `k * 4` | Semantic (situation cosine) pool — unchanged, applies to `split` and `hybrid`. |

No new embedding model or API changes. FTS5 is a SQLite extension — no external
service.

---

## Testing strategy

- **Unit — `buildFts5Query`:** strips FTS5 special characters; handles empty
  string; handles OR/AND/NOT keywords; preserves normal tech terms like
  "postgres", "redis-streams", "FTS5".
- **Unit — `fuseRRF`:** correct RRF formula (`1/(c + rank)`, 1-indexed); one-channel-only
  candidates; empty lists; tie-breaking stable; `c=60` baseline.
- **Integration — `rankByLexical`:** needs a real SQLite file with FTS5 rows.
  Use a fixture DB built with `saveIndex` in a temp dir. Assert BM25 ordering
  matches expectation for exact term matches vs partial matches.
- **Integration — `retrieveContext` hybrid path:** inject v3 index double with
  `experiences_fts` populated and `lexicalSearch` override returning fixture hits.
  Assert RRF fusion happens, `minScore` is 0 on trace params, FTS5 fallback to
  situation-only on `lexicalSearch` throw.
- **Store round-trip:** `saveIndex` → `loadIndex` v3 (vectors + FTS5 rows present).
  Assert `rankByLexical` returns results from the saved FTS5 table.
- **Regression:** `LINKROWTH_RETRIEVAL_STRATEGY=single` (default) — all existing
  `retrieveContext` and store tests pass unchanged.

Existing suites to keep green: `retrieveContext.test.ts`, `store.test.ts`,
`select.test.ts`, `queryConstruction.test.ts`, `vector.test.ts`.

---

## Rollout order (PR stack)

1. **PR A — distill: FTS5 schema v3** — `EXPERIENCE_INDEX_SCHEMA_VERSION = 3`,
   `experiences_fts` table in `SCHEMA`, `saveIndex` FTS5 inserts, `loadIndex`
   v3 check, CLI `--channel lexical`. Distill-only; agent still rejects v3 under
   current v2 check — rebuild is offline.

2. **PR B — agent types + store: BM25 + RRF** — bump agent `EXPERIENCE_INDEX_SCHEMA_VERSION`
   to 3; add `LexicalRankedArtifact`, `FusedCandidate`; implement `buildFts5Query`,
   `rankByLexical`, `fuseRRF` with unit tests and store round-trip test.

3. **PR C — agent: `hybrid` strategy behind flag** — extend `RetrievalStrategy`,
   `parseRetrievalStrategy`, `RetrieveContextOptions`; hybrid path in
   `retrieveContext`; FTS5 graceful fallback; trace v3 + migration `0005`.

4. **PR D — eval and tune** — run eval harness (from Phase 2 scaffold) over
   labeled set with `single`, `split`, and `hybrid`; tune `LINKROWTH_RETRIEVAL_RRF_C`
   and pool sizes from recall curves; record numbers in docs; update
   `retrieval-matching-design.md` Phase 3 bullets.

Each PR leaves `single` as the shipped default. No production selection change
until PR D's comparison meets the design's success bar.

---

## Evaluation: compare all three strategies

Extends the Phase 2 eval harness (`agent/src/context/retrievalEvalCli.ts`) with
a third strategy run per labeled row.

### Additional metrics for Phase 3

| Metric | Question |
| --- | --- |
| Recall@N (hybrid) | Does BM25 recover candidates the semantic channel misses? |
| Lexical-only recall | Fraction of `relevantSituationIds` found *only* by BM25 (measures added value) |
| Precision@k (hybrid) | Final selected hits vs `safeToInjectIds` |
| Exact-term recovery | On posts with exact tech names, does hybrid rank correct artifact higher than split? |

### Success bar for Phase 3

Proceed to mark `hybrid` production-ready only when **all** of the following hold:

1. Hybrid recall@N ≥ split recall@N (lexical must add, not subtract)
2. Hybrid precision@k ≥ split precision@k
3. Safety pass rate = 100%
4. Abstention accuracy = 100% on `shouldAbstain` rows
5. Lexical-only recall > 0 (BM25 meaningfully recovers candidates missed semantically)

If lexical channel hurts precision (too many false positives survive RRF fusion),
decrease `LINKROWTH_RETRIEVAL_RRF_C` (makes ranks matter more) or tighten BM25
`paths` weight. Do not ship `hybrid` as default until bar passes.

---

## Explicitly out of scope (later phases)

- Moving retrieval after the analyzer; `generateCandidates` / `selectForAnalysis`
  split; HITL resume synchronization (Phase 4).
- Using evidence scores to gate or reorder proof points (Phase 4).
- LLM / cross-encoder reranker (Phase 5).
- Approximate nearest-neighbor index (design non-goal while index is small).

---

## Open questions

1. **FTS5 query mode — term vs phrase** — starting with term-based (`space-separated
   tokens`). If recall on exact multi-word stack names suffers (e.g., `Redis Streams`),
   consider a mixed strategy: try phrase first, fall back to terms on empty result.
   Decide in PR D after eval.

2. **Per-column BM25 weight tuning** — defaults (`title=3, domains=2, stack=2,
   problem=2, approach=1.5, paths=0.5`) are principled estimates, not measured.
   Tune against labeled set in PR D. Make weights configurable via
   `LINKROWTH_RETRIEVAL_BM25_WEIGHTS` JSON env var or hard-coded with trace record.

3. **Semantic vs lexical pool sizes** — default both to `k * 4`. RRF is most
   useful when pool sizes are large enough that each channel surfaces some
   unique candidates. Tune from recall curves in PR D.

4. **`rankByLexical` DB access pattern** — currently opens and closes the DB on
   each call. Acceptable for the current index size and per-request frequency.
   Revisit if retrieval latency budget becomes a concern (Phase 4).

5. **FTS5 tokenizer** — `unicode61` default handles most tech terms correctly.
   Custom tokenizer (e.g., camelCase splitting) is a future option if token
   boundary issues emerge in eval.
