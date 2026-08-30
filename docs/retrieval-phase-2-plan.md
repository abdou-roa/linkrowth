# Phase 2 Plan — Split Semantic Fields (Situation + Evidence Vectors)

This is the working plan for **Phase 2** of the retrieval-matching rollout
defined in [`retrieval-matching-design.md`](./retrieval-matching-design.md).
It is a plan, not shipped behavior. It refines the design's Phase 2 bullets into
concrete files, contracts, schema, flags, and an evaluation method.

Phase 2 scope, verbatim from the design's incremental rollout:

- build situation and evidence vectors;
- version and rebuild the SQLite index;
- retrieve broad candidates by situation cosine;
- define the deterministic analysis-derived query used later for evidence
  scoring;
- compare against the baseline before changing production selection.

**Guiding constraint:** Phase 2 changes *how experience is represented and
scored*, but must **not** change what production injects into `proofPoints`
until the labeled comparison in step 5 justifies it. The new path ships behind a
strategy flag, defaulting to the current single-vector baseline.

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

## Current state (what Phase 2 changes)

One vector per artifact, built from a flattened string:

- `distill/src/index/vector.ts` → `retrievalText()` concatenates
  `title, domains, stack, problem, approach, tradeoff, claimableLine, paths`.
- `distill/src/index/store.ts` → `buildIndex()` / `saveIndex()` write one
  `experiences.vector` BLOB plus `index_meta`.
- `agent/src/context/experience/store.ts` → `loadIndex()` / `rankIndex()` read
  that single vector and cosine-rank.
- `agent/src/context/retrieveContext.ts` → embeds `situationQuery`, calls
  `rankIndex(index, queryVector, k*3)`, then `evaluateHits()`.

Phase 2 splits the single vector into two and adds a deterministic
analysis-derived query for a **later** (Phase 4) evidence-scoring stage — the
query is *defined and traced* in Phase 2, not yet used to gate selection.

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

### WB1 — Distill: build two vectors

- `distill/src/index/vector.ts`: add `situationText(artifact)` and
  `evidenceText(artifact)` alongside the existing `retrievalText()` (keep the
  latter for the `single` strategy). Keep `cosineSimilarity()` shared.
- `distill/src/index/store.ts`: extend `buildIndex()` to embed both texts per
  artifact (two `embed()` passes or one batched pass over interleaved texts),
  and `saveIndex()` to write `situation_vector` + `evidence_vector` and
  `schema_version = 2`. Add `EXPERIENCE_INDEX_SCHEMA_VERSION` constant.
- `distill/src/index/run.ts`: no interface change; it calls `buildIndex` /
  `saveIndex`. Confirm batching still holds for two vectors.
- `distill/src/index/searchCli.ts`: add a `--channel situation|evidence` option
  so the debug CLI can inspect either channel's raw cosine.
- `distill/src/types.ts`: add the v2 index/embedding shapes
  (`situationVector` / `evidenceVector` on `IndexedExperience`).

### WB2 — Agent: read + rank the split index

- `agent/src/context/experience/types.ts`: mirror the v2 shapes
  (`situationVector`, `evidenceVector`, `schemaVersion`).
- `agent/src/context/experience/store.ts`: `loadIndex()` reads both BLOBs +
  `schema_version`; reject `!= 2` under the `split` strategy. Add
  `rankBySituation(index, queryVector, k)` (cosine over `situationVector`) and a
  helper `evidenceScore(item, evidenceVector)` (cosine over `evidenceVector`)
  used only to annotate the trace in Phase 2.
- `agent/src/context/experience/vector.ts`: mirror `situationText` /
  `evidenceText` for alignment parity (documented note: query alignment comes
  from model semantics, not identical formatting).

### WB3 — Agent: query construction for the evidence channel

- `agent/src/context/queryConstruction.ts`: add `buildEvidenceQuery(analysis)`
  returning `{ evidenceQuery, presentFields, constructedLength }`. Pure,
  synchronous, unit-tested. `buildRetrievalQuery(post)` is unchanged.

### WB4 — Agent: retrieval orchestration behind the flag

- `agent/src/context/retrieveContext.ts`:
  - Resolve `LINKROWTH_RETRIEVAL_STRATEGY`.
  - `single`: unchanged behavior.
  - `split`: embed `situationQuery` → `rankBySituation(..., candidatePoolSize)`
    → `evaluateHits()` (unchanged eligibility) → **still inject on situation
    channel only**. If an analysis is available (test/eval injection point),
    compute each candidate's evidence cosine and attach it to the trace hit.
  - Keep the current graceful-degradation ladder
    (`empty_query`, `no_index`, `embed_failed`, `no_survivors`).

### WB5 — Traces: version bump + per-channel signals

- `agent/src/persistence/retrievalTrace/types.ts`: bump
  `RETRIEVAL_TRACE_SCHEMA_VERSION` to `2`; add optional
  `situationScore` / `evidenceScore` to `RetrievalTraceHit`, `strategy` and
  index `schemaVersion` to params/index meta, and the evidence-query provenance.
- `agent/src/persistence/retrievalTrace/repository.ts` +
  `db/migrations/`: additive migration for the new nullable columns/JSON so
  v1 traces remain readable.

### WB6 — Docs

- Update [`retrieval-layer.md`](./retrieval-layer.md): v2 schema, the two
  channels, the strategy flag, and the new CLI option.
- Update [`retrieval-matching-design.md`](./retrieval-matching-design.md):
  mark Phase 2 as in-progress and fix the stale "post body plus the author's
  headline" baseline note (already superseded by Tier A).
- Add the missing [`retrieval-query-construction.md`](./retrieval-query-construction.md)
  referenced by both docs, covering `buildRetrievalQuery` and the new
  `buildEvidenceQuery`.

---

## New / changed environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LINKROWTH_RETRIEVAL_STRATEGY` | `single` | `single` (baseline) or `split` (Phase 2 situation/evidence). |
| `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | `k * 4` (tune in step 5) | Situation-channel recall pool before eligibility + `k`. |

No embed-model env changes. `LINKROWTH_RETRIEVAL_K` / `LINKROWTH_RETRIEVAL_MIN_SCORE`
keep their meaning.

---

## Evaluation: compare against the baseline before changing production

This is the gate before any production selection change (design acceptance
criteria 1–8). Nothing in Phase 2 alters injected proof points until this
passes.

### Labeled set (bootstrap)

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

### Harness

- A script (e.g. `distill/src/index/evalCli.ts`, `npm run eval`) builds a v2
  index from the eval artifacts, runs both strategies over the labeled posts via
  the real `retrieveContext` seam (injecting `loadIndex`/`embedQuery` doubles or
  a cached embedding fixture to keep CI offline), and prints a comparison table.
- Success bar to proceed to Phase 3/4: split **preserves or improves**
  recall@N and precision@k over baseline, keeps 100% safety exclusion, and shows
  measurable evidence-cosine separation between applicable evidence and hard
  negatives. If it does not, keep `single` as the default and iterate on field
  composition (D1) rather than shipping `split`.

---

## Testing strategy

Phase 2 is offline/library code (no UI), so verification is automated:

- Unit: `situationText` / `evidenceText` composition;
  `buildEvidenceQuery` field mapping and provenance; `rankBySituation`;
  `loadIndex` schema-version acceptance/rejection; strategy resolution.
- Integration: `retrieveContext.test.ts` gains `split`-strategy cases
  (injected v2 index + embed double) asserting situation-only injection,
  evidence scores present on traces, and graceful fallback on version mismatch.
- Store round-trip: `saveIndex` → `loadIndex` for v2 (two BLOBs, `schema_version`).
- Eval harness run on the fixture set, checked into CI as a smoke test with a
  frozen embedding fixture (no live API in CI).
- Regression: with `LINKROWTH_RETRIEVAL_STRATEGY=single` (default), all existing
  tests pass unchanged — the baseline path is untouched.

Existing suites to keep green: `agent/src/context/retrieveContext.test.ts`,
`agent/src/context/experience/store.test.ts`,
`agent/src/context/experience/select.test.ts`,
`agent/src/context/queryConstruction.test.ts`,
`distill/src/index/vector.test.ts`.

---

## Rollout order (PR stack)

1. **PR A — schema + distill build:** v2 schema constant, `situationText` /
   `evidenceText`, `buildIndex` / `saveIndex` two-vector write, CLI `--channel`.
   (Distill-only; agent still reads v1 under `single`.)
2. **PR B — agent read + split ranking behind flag:** `loadIndex` v2,
   `rankBySituation`, strategy flag, `retrieveContext` split path injecting on
   situation only. Trace schema bump + migration.
3. **PR C — evidence query + eval harness:** `buildEvidenceQuery`, evidence-score
   trace annotation, `npm run eval`, labeled fixture set, baseline comparison.
4. **PR D — docs:** update the three retrieval docs; record measured numbers.

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
   placeholder (`k * 4`).
2. **Two embed passes vs one** — batching both channels in a single `embed()`
   call halves round-trips but needs careful index bookkeeping; decide in PR A.
3. **Committing an eval fixture** — how much redacted labeled data can live in
   the repo for CI vs staying in gitignored `distill/data/eval/`.
4. **Evidence query at production time** — Phase 2 keeps it offline-only; confirm
   we do not want an interim "post-derived pseudo-evidence" query before Phase 4
   moves ordering.
