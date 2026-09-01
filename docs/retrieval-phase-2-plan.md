# Phase 2 Plan — Split Semantic Fields (Situation + Evidence Vectors)

This is the working plan for **Phase 2** of the retrieval-matching rollout
defined in [`retrieval-matching-design.md`](./retrieval-matching-design.md).
It refines the design's Phase 2 bullets into concrete files, contracts, schema,
flags, and an evaluation method.

**Status: implementation complete; evaluation pending.** The split-vector
pipeline ships behind `LINKROWTH_RETRIEVAL_STRATEGY=split` (default remains
`single`). The labeled baseline comparison in step 5 has not been built yet —
that is the remaining gate before changing production selection.

Phase 2 scope, verbatim from the design's incremental rollout:

- build situation and evidence vectors; ✅
- version and rebuild the SQLite index; ✅
- retrieve broad candidates by situation cosine; ✅
- define the deterministic analysis-derived query used later for evidence
  scoring; ✅
- compare against the baseline before changing production selection. ⬜

**Guiding constraint:** Phase 2 changes *how experience is represented and
scored*, but must **not** change what production injects into `proofPoints`
until the labeled comparison in step 5 justifies it. The new path ships behind a
strategy flag, defaulting to the current single-vector baseline.

---

## Implementation status

| Area | Status | Notes |
| --- | --- | --- |
| WB1 — Distill: two-vector index build | **Done** | `situationText` / `evidenceText`, batched interleaved embed, v2 `saveIndex`, CLI `--channel` |
| WB2 — Agent: read + rank split index | **Done** | `loadIndex` v2, `rankBySituation`, `evidenceScore`, schema-version rejection |
| WB3 — Evidence query construction | **Done** | `buildEvidenceQuery(analysis)` with provenance; unit-tested |
| WB4 — Retrieval orchestration + flag | **Done** | `LINKROWTH_RETRIEVAL_STRATEGY`, `LINKROWTH_RETRIEVAL_CANDIDATE_POOL`, split path in `retrieveContext` |
| WB5 — Trace schema v2 | **Done** | `RETRIEVAL_TRACE_SCHEMA_VERSION = 2`, per-channel scores on hits, `db/migrations/0004_retrieval_trace_v2.sql` |
| WB6 — Docs | **Done** | `retrieval-layer.md`, `retrieval-query-construction.md`, design doc Phase 2 bullets updated |
| Evaluation harness + labeled set | **Not started** | No `phase2.jsonl`, no `evalCli.ts`, no `npm run eval` in distill |
| Production selection change | **Blocked** | Remains on situation channel only; `single` stays the default until eval passes |

---

## Prerequisites and dependencies

| Dependency | State | Needed because |
| --- | --- | --- |
| Tier A query construction (PR #30, `queryConstruction.ts`) | Landed on this stack | The situation channel query is the Tier A `situationQuery` (cleaned body). |
| Retrieval traces (`RETRIEVAL_TRACE_SCHEMA_VERSION = 1`) | Landed | Phase 2 adds per-channel scores; trace schema must bump. |
| Phase 1 (prefilter before candidate limits) | **Not landed** | Not a hard blocker, but recall math (step 3) is cleaner once eligibility runs before the candidate cap. Plan treats Phase 1 as parallel, not blocking. |
| Labeled evaluation set (design Phase 0) | **Not in repo** | Step 5 comparison needs labeled post↔artifact triples. This plan includes a minimal bootstrap. |

If Phase 1 has not landed when Phase 2 begins, keep the current
`evaluateHits()` post-rank filtering and simply widen the candidate pool; do not
block on Phase 1.

---

## Current state

### Baseline (`LINKROWTH_RETRIEVAL_STRATEGY=single`, default)

Unchanged. One combined vector per artifact (`retrievalText()`), ranked by
`rankIndex()`, same eligibility filters and injection path as before.

### Split strategy (`LINKROWTH_RETRIEVAL_STRATEGY=split`)

Implemented:

- `distill/src/index/vector.ts` → `situationText()` and `evidenceText()` alongside
  `retrievalText()`; `paths` dropped from both semantic channels (D1).
- `distill/src/index/store.ts` → `buildIndex()` embeds all three texts per artifact
  (batched interleaved pass); `saveIndex()` writes `situation_vector`,
  `evidence_vector`, and `schema_version = 2`.
- `agent/src/context/experience/store.ts` → `loadIndex()` reads v2 BLOBs; rejects
  schema mismatch under `split`; `rankBySituation()` for candidate gen;
  `evidenceScore()` annotates traces only.
- `agent/src/context/retrieveContext.ts` → embeds `situationQuery`, ranks by
  situation cosine over a widened `candidatePoolSize`, then `evaluateHits()`.
  Evidence cosine is computed and traced when `analysis` is passed (tests/eval
  injection point); production still injects on situation channel only.

The deterministic analysis-derived evidence query (`buildEvidenceQuery`) is
defined and traced in Phase 2 but not yet used to gate selection — that wiring
is Phase 4.

---

## Design decisions

### D1. Two vectors, explicit field split

| Vector | Fields (in order) | Question it answers |
| --- | --- | --- |
| **Situation** | `title`, `domains` (joined), `stack` (joined), `problem` | "Is this the same kind of situation?" |
| **Evidence** | `approach`, `tradeoff`, `claimableLine` | "Is this experience usable evidence for the intended response?" |

`paths` are intentionally dropped from both semantic vectors — they are a
lexical signal reserved for the Phase 3 BM25 channel, and today they dilute the
situation match. This is a deliberate representation change to validate in
step 5, not a silent regression.

Both vectors use the same provider/model/dimensions as today (no new embed
model). Index-side embedding keeps the Gemini `RETRIEVAL_DOCUMENT` task type;
the situation **query** keeps `RETRIEVAL_QUERY`. The evidence query
(analysis-derived, §D4) also uses `RETRIEVAL_QUERY`.

### D2. Index schema version + full rebuild

The index is reproducible offline data, so bump a schema version and rebuild
rather than reinterpret the existing `vector` column. The agent must reject an
incompatible index cleanly and fall back to static context (never crash, never
silently score a v1 index as if it were v2).

Add `schema_version` to `index_meta` and two BLOB columns to `experiences`:

```sql
-- index_meta gains:
--   schema_version INTEGER NOT NULL   -- 2 for the split-vector layout
-- experiences gains (replacing the single `vector` column):
--   situation_vector BLOB NOT NULL
--   evidence_vector  BLOB NOT NULL
```

`EXPERIENCE_INDEX_SCHEMA_VERSION = 2` becomes a shared constant. `loadIndex()`
returns `null` (→ `no_index` outcome, static fallback) when `schema_version`
is absent or `!= 2` while the split-vector strategy is active. When the
single-vector strategy is active, the agent still reads a v1 index (see §D5 for
how both coexist behind the flag).

### D3. Broad candidate retrieval by situation cosine

Candidate generation ranks **situation vectors only** by cosine against the
embedded Tier A `situationQuery`. It optimizes for recall with a widened pool
(`candidatePoolSize`, default larger than today's `k*3`; exact value chosen by
step 5), then applies the existing eligibility filters
(`shareability`, `confidence`, empty-claim) to produce the shortlist.

Evidence vectors are **loaded and scored but not used to gate** in Phase 2 —
each candidate's evidence cosine (against the analysis-derived query) is
computed and written to the trace so we can measure its value before Phase 4
wires it into selection.

### D4. Deterministic analysis-derived evidence query

Phase 2 *defines* the deterministic function that maps an `AnalysisArtifact`
(from `agent/src/steps/analyzer.ts`) into an evidence-channel query string. It
is deterministic (string assembly, no LLM) and observable. Proposed mapping,
using real `AnalysisArtifact` fields:

```text
coreThesis
pivotStrategy.insightDirection
pivotStrategy.acknowledgedPoint
answerableQuestions(analysis).map(q => q.text)   // decision === "answer"
unspokenTradeoffs
```

Assembled by a new `buildEvidenceQuery(analysis): EvidenceQuery` in
`agent/src/context/queryConstruction.ts`, mirroring the existing
`buildRetrievalQuery(post)` shape (returns the text plus provenance:
which fields were present, resulting length). Rationale for these fields: they
capture *the response the agent intends to make*, which is exactly what the
evidence vector (`approach + tradeoff + claimableLine`) should be scored
against — not the raw post.

**Ordering caveat.** Today retrieval runs entirely before the analyzer
(`runEngageWithStatus` → `retrieveContext` → `MultiStepEngageAgent.run`). The
`AnalysisArtifact` does not exist at retrieval time. Phase 2 therefore does
**not** move pipeline ordering (that is Phase 4's "required integration
change"). Instead it makes the evidence query computable and testable in
isolation, and — for offline evaluation only — feeds it a precomputed analysis
so we can measure evidence-cosine quality. Production selection stays on the
situation channel until Phase 4.

### D5. Strategy flag and graceful coexistence

Add `LINKROWTH_RETRIEVAL_STRATEGY` (or extend the existing tier concept):

| Value | Meaning |
| --- | --- |
| `single` (default) | Current single-vector cosine pipeline. Reads a v1 index. |
| `split` | Phase 2 situation/evidence pipeline. Reads a v2 index. |

The flag lets us A/B the baseline against the split representation without
rebuilding application code (design requirement: "each phase should be
deployable behind a strategy flag"). Selecting `split` against a v1 index (or
`single` against a v2-only index) logs a clear mismatch and falls back to static
context rather than mis-scoring.

---

## Work breakdown

### WB1 — Distill: build two vectors ✅

- [x] `distill/src/index/vector.ts`: `situationText(artifact)` and
  `evidenceText(artifact)` alongside `retrievalText()` (kept for `single`).
  `cosineSimilarity()` shared.
- [x] `distill/src/index/store.ts`: `buildIndex()` embeds all three texts per
  artifact via one batched interleaved pass; `saveIndex()` writes
  `situation_vector` + `evidence_vector` and `schema_version = 2`.
  `EXPERIENCE_INDEX_SCHEMA_VERSION = 2` in `distill/src/types.ts`.
- [x] `distill/src/index/run.ts`: no interface change; batching confirmed for
  three vectors per artifact.
- [x] `distill/src/index/searchCli.ts`: `--channel single|situation|evidence`.
- [x] `distill/src/types.ts`: v2 shapes (`situationVector` / `evidenceVector` on
  `IndexedExperience`).

### WB2 — Agent: read + rank the split index ✅

- [x] `agent/src/context/experience/types.ts`: v2 shapes (`situationVector`,
  `evidenceVector`, `schemaVersion`).
- [x] `agent/src/context/experience/store.ts`: `loadIndex()` reads both BLOBs +
  `schema_version`; rejects `!= 2` under `split`. `rankBySituation()` and
  `evidenceScore()` (trace annotation only in Phase 2).
- [x] `agent/src/context/experience/vector.ts`: mirrored `situationText` /
  `evidenceText` for alignment parity.

### WB3 — Agent: query construction for the evidence channel ✅

- [x] `agent/src/context/queryConstruction.ts`: `buildEvidenceQuery(analysis)`
  returning `{ evidenceQuery, provenance, constructedLength }`. Pure,
  synchronous, unit-tested. `buildRetrievalQuery(post)` unchanged.

### WB4 — Agent: retrieval orchestration behind the flag ✅

- [x] `agent/src/context/retrieveContext.ts`:
  - Resolves `LINKROWTH_RETRIEVAL_STRATEGY` (`single` default, `split` for Phase 2).
  - `single`: unchanged behavior.
  - `split`: embed `situationQuery` → `rankBySituation(..., candidatePoolSize)`
    → `evaluateHits()` → **still inject on situation channel only**. When
    `analysis` is provided (test/eval injection), evidence cosine is computed and
    attached to each trace hit.
  - Graceful-degradation ladder preserved (`empty_query`, `no_index`,
    `embed_failed`, `no_survivors`).

### WB5 — Traces: version bump + per-channel signals ✅

- [x] `agent/src/persistence/retrievalTrace/types.ts`: `RETRIEVAL_TRACE_SCHEMA_VERSION = 2`;
  optional `situationScore` / `evidenceScore` on `RetrievalTraceHit`; `strategy`,
  `schemaVersion`, and evidence-query provenance on trace params/index meta.
- [x] `db/migrations/0004_retrieval_trace_v2.sql`: documents v2 JSONB fields; no
  DDL change needed (candidates/params/timings are JSONB). v1 traces remain readable.

### WB6 — Docs ✅

- [x] [`retrieval-layer.md`](./retrieval-layer.md): v2 schema, two channels,
  strategy flag, CLI `--channel`.
- [x] [`retrieval-matching-design.md`](./retrieval-matching-design.md): Phase 2
  marked in-progress with implementation checkmarks on the first four bullets.
- [x] [`retrieval-query-construction.md`](./retrieval-query-construction.md):
  covers `buildRetrievalQuery` and `buildEvidenceQuery`.

---

## New / changed environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKROWTH_RETRIEVAL_STRATEGY` | `single` | `single` (baseline) or `split` (Phase 2 situation/evidence). |
| `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | `k * 4` (tune in step 5) | Situation-channel recall pool before eligibility + `k`. |

No embed-model env changes. `LINKROWTH_RETRIEVAL_K` / `LINKROWTH_RETRIEVAL_MIN_SCORE`
keep their meaning.

---

## Evaluation: compare against the baseline before changing production *(not started)*

This is the gate before any production selection change (design acceptance
criteria 1–8). Nothing in Phase 2 alters injected proof points until this
passes. **This is the only remaining Phase 2 work.**

### Labeled set (bootstrap) — not started

Store under `distill/data/eval/phase2.jsonl` (gitignored like other index data;
a tiny redacted sample may be committed under `distill/src/index/__fixtures__`
for CI). Each row:

```jsonc
{
  "post": { "text": "...", "author": { "headline": "..." } },
  "analysis": { /* precomputed AnalysisArtifact for evidence-query eval */ },
  "relevantSituationIds": ["..."],   // same-situation artifacts
  "applicableEvidenceIds": ["..."],  // artifacts whose evidence supports the angle
  "safeToInjectIds": ["..."],
  "shouldAbstain": false,
  "hardNegativeIds": ["..."]         // shared stack terms, different problem
}
```

Include the design's required post shapes: exact-tech-name posts, conceptual
matches without shared vocabulary, problem-only wording, and no-match posts.

### Metrics (per provider/model)

| Metric | Compares |
| --- | --- |
| Recall@candidate-N | split situation channel vs baseline single-vector, at equal N. |
| Precision@k | final survivors, split vs baseline. |
| MRR / nDCG | rank quality of the best relevant artifact. |
| Evidence-cosine separation | evidence score on `applicableEvidenceIds` vs `hardNegativeIds` (validates D4 before Phase 4 uses it). |
| Safety pass rate | private/low-confidence/empty-claim always excluded (must be 100%). |
| Abstention accuracy | no injection on `shouldAbstain` posts. |

### Harness — not started

- [ ] A script (e.g. `distill/src/index/evalCli.ts`, `npm run eval` in distill)
  builds a v2 index from the eval artifacts, runs both strategies over the
  labeled posts via the real `retrieveContext` seam (injecting `loadIndex`/
  `embedQuery` doubles or a cached embedding fixture to keep CI offline), and
  prints a comparison table.
- Success bar to proceed to Phase 3/4: split **preserves or improves**
  recall@N and precision@k over baseline, keeps 100% safety exclusion, and shows
  measurable evidence-cosine separation between applicable evidence and hard
  negatives. If it does not, keep `single` as the default and iterate on field
  composition (D1) rather than shipping `split`.

---

## Testing strategy

Phase 2 is offline/library code (no UI), so verification is automated:

- [x] Unit: `situationText` / `evidenceText` composition;
  `buildEvidenceQuery` field mapping and provenance; `rankBySituation`;
  `loadIndex` schema-version acceptance/rejection; strategy resolution.
- [x] Integration: `retrieveContext.test.ts` `split`-strategy cases (injected
  v2 index + embed double) asserting situation-only injection, evidence scores
  on traces, and graceful fallback on version mismatch.
- [x] Store round-trip: `saveIndex` → `loadIndex` for v2 (two BLOBs, `schema_version`).
- [ ] Eval harness run on the fixture set, checked into CI as a smoke test with a
  frozen embedding fixture (no live API in CI).
- [x] Regression: with `LINKROWTH_RETRIEVAL_STRATEGY=single` (default), existing
  tests pass unchanged — the baseline path is untouched.

Existing suites to keep green: `agent/src/context/retrieveContext.test.ts`,
`agent/src/context/experience/store.test.ts`,
`agent/src/context/experience/select.test.ts`,
`agent/src/context/queryConstruction.test.ts`,
`distill/src/index/vector.test.ts`.

---

## Rollout order (PR stack)

1. **PR A — schema + distill build** ✅ — v2 schema constant, `situationText` /
   `evidenceText`, `buildIndex` / `saveIndex` two-vector write, CLI `--channel`.
2. **PR B — agent read + split ranking behind flag** ✅ — `loadIndex` v2,
   `rankBySituation`, strategy flag, `retrieveContext` split path injecting on
   situation only. Trace schema bump + migration.
3. **PR C — evidence query + eval harness** *(partial)* — `buildEvidenceQuery` and
   evidence-score trace annotation are done; labeled fixture set, `evalCli.ts`,
   and baseline comparison remain.
4. **PR D — docs** ✅ — three retrieval docs updated; measured numbers pending
   eval harness (PR C remainder).

Each PR is independently reviewable and leaves `single` as the shipped default.
No production selection change lands until PR C's comparison meets the success
bar.

---

## Explicitly out of scope (later phases)

- BM25 / FTS5 lexical channel and RRF fusion (Phase 3).
- Moving retrieval after the analyzer; `generateCandidates` / `selectForAnalysis`
  split; HITL-resume synchronization (Phase 4).
- LLM / cross-encoder reranker (Phase 5).
- Using the evidence score to gate or reorder injected proof points — Phase 2
  only measures it.

---

## Open questions

1. **`candidatePoolSize`** — set by step 5 recall curves; default is a
   placeholder (`k * 4`). *(Implemented as `LINKROWTH_RETRIEVAL_CANDIDATE_POOL`,
   default `k * 4`; tuning deferred to eval.)*
2. ~~**Two embed passes vs one**~~ — **Resolved:** single batched interleaved
   `embed()` call over `[combined, situation, evidence]` per artifact (PR A).
3. **Committing an eval fixture** — how much redacted labeled data can live in
   the repo for CI vs staying in gitignored `distill/data/eval/`. *(Still open;
   blocks eval harness.)*
4. **Evidence query at production time** — Phase 2 keeps it offline-only; confirm
   we do not want an interim "post-derived pseudo-evidence" query before Phase 4
   moves ordering. *(Confirmed: `analysis` is only passed via
   `RetrieveContextOptions` in tests/eval; production path leaves it undefined.)*
