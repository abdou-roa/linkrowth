# Phase 2 Evaluation — Baseline Comparison Harness

This document is the implementation spec for the **remaining Phase 2 work**:
offline A/B comparison of `single` vs `split` retrieval strategies before
changing production selection. Parent plan:
[`retrieval-phase-2-plan.md`](./retrieval-phase-2-plan.md). Design acceptance
criteria: [`retrieval-matching-design.md`](./retrieval-matching-design.md) §
Validation plan.

**Status:** scaffold only — harness not implemented yet.

---

## Goal

Answer one question with labeled data:

> Does `LINKROWTH_RETRIEVAL_STRATEGY=split` preserve or improve retrieval quality
> over the `single` baseline, without breaking safety filters?

Until this passes, production stays on `single`. Evidence scores are measured
but do **not** gate injection in Phase 2.

---

## What gets compared

| Run | Strategy | Candidate ranking | Pool size | Selection |
| --- | --- | --- | --- | --- |
| Baseline | `single` | `rankIndex` on combined `vector` | `max(k * 3, k)` | `evaluateHits()` |
| Candidate | `split` | `rankBySituation` on `situationVector` | `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` (default `k * 4`) | `evaluateHits()` (situation score only) |

Both runs use the same `k`, `minScore`, index, and `buildRetrievalQuery(post)`.
Split runs additionally pass a precomputed `analysis` so evidence cosine can be
scored offline (production does not have analysis at retrieval time yet).

Entry point: `retrieveContext()` in `agent/src/context/retrieveContext.ts`.
Override `loadIndex`, `embedQuery`, `strategy`, `analysis`, and `traceSink` as
in `retrieveContext.test.ts`.

---

## Labeled dataset

### Location

| Path | Purpose |
| --- | --- |
| `distill/data/eval/phase2.jsonl` | Full labeled set (gitignored via `distill/data/`) |
| `agent/src/context/__fixtures__/phase2-eval.sample.jsonl` | One redacted row for CI smoke tests |

### Row schema

```jsonc
{
  "id": "eval_001",
  "post": {
    "text": "...",
    "author": { "headline": "..." }
  },
  "analysis": {
    // Precomputed AnalysisArtifact — required for evidence-channel metrics
    "category": "technical",
    "coreThesis": "...",
    "pivotStrategy": { "insightDirection": "...", "acknowledgedPoint": "..." },
    "answerableQuestions": [{ "text": "...", "decision": "answer" }],
    "unspokenTradeoffs": ["..."]
  },
  "relevantSituationIds": ["exp_postgres_queue"],
  "applicableEvidenceIds": ["exp_postgres_queue"],
  "safeToInjectIds": ["exp_postgres_queue"],
  "shouldAbstain": false,
  "hardNegativeIds": ["exp_kafka_streams"]
}
```

### Required post shapes (minimum ~20 rows to start)

- Exact technology name in post body
- Conceptual match without shared vocabulary
- Problem-only wording (no stack terms)
- No matching experience (`shouldAbstain: true`)
- Hard negative: shared stack terms, different problem
- At least one row where only situation match matters (evidence angle differs)

Labels reference **artifact IDs** present in the eval index built from your
distilled experience set.

---

## Metrics

Score each labeled row at **two stages**:

### Stage A — candidate generation (recall)

From `trace.candidates` ordered by `rank` (pre-filter cosine ranking).

| Metric | Definition | Labels |
| --- | --- | --- |
| Recall@N | Fraction of rows where any `relevantSituationIds` appears in top-N candidates | `relevantSituationIds` |
| MRR | Mean reciprocal rank of first relevant situation ID | `relevantSituationIds` |
| nDCG@N | Rank quality of relevant situation IDs | `relevantSituationIds` |

Use the same N for both strategies (e.g. N = `candidatePoolSize`).

### Stage B — final injection (precision + safety)

From candidates where `selected: true` (post-`evaluateHits()`).

| Metric | Definition | Labels |
| --- | --- | --- |
| Precision@k | Selected IDs ∩ `safeToInjectIds` / selected count | `safeToInjectIds` |
| Abstention accuracy | On `shouldAbstain` rows, outcome is `no_survivors` or `empty_query` with zero selected | `shouldAbstain` |
| Safety pass rate | Private / low-confidence / empty-claim artifacts never selected | Must be **100%** |

### Stage C — evidence channel (split only, offline)

When `analysis` is passed and evidence embed succeeds:

| Metric | Definition | Labels |
| --- | --- | --- |
| Evidence separation | Mean `evidenceScore` on `applicableEvidenceIds` minus mean on `hardNegativeIds` | `applicableEvidenceIds`, `hardNegativeIds` |

Does not gate injection in Phase 2 — validates `buildEvidenceQuery` before
Phase 4 wires evidence into selection.

---

## Success bar

Proceed to flip default strategy (or tune `candidatePoolSize`) only when **all**
of the following hold for the pinned provider/model:

1. Split **preserves or improves** recall@N and precision@k vs `single`
2. Safety pass rate = **100%** on all rows
3. Abstention accuracy = **100%** on `shouldAbstain` rows
4. Evidence separation > 0 with meaningful margin (tune threshold after first run)

If split fails, iterate on `situationText` / `evidenceText` field composition
(D1) — do not ship `split` as default.

---

## Harness design

### CLI

```
npm run eval:retrieval -- [options]

Options:
  --dataset <path>     JSONL labeled set (default: distill/data/eval/phase2.jsonl)
  --index <path>       experience-index.db (default: distill/data/experience-index.db)
  --k <n>              Default 5
  --min-score <n>      Default 0.3
  --pool <n>           Override LINKROWTH_RETRIEVAL_CANDIDATE_POOL for split
  --recall-n <n>       N for recall@N (default: pool size)
  --fixture            Use frozen embeddings from dataset row (CI mode)
  --json               Emit machine-readable results
```

Implementation scaffold: `agent/src/context/retrievalEvalCli.ts`.

### Per-row loop (pseudocode)

```ts
for (const row of dataset) {
  const baseOpts = { loadIndex, embedQuery, k, minScore, traceSink: capture };

  const singleTrace = await retrieveContext(row.post, baseContext, {
    ...baseOpts,
    strategy: "single",
  });

  const splitTrace = await retrieveContext(row.post, baseContext, {
    ...baseOpts,
    strategy: "split",
    analysis: row.analysis,
    candidatePoolSize: pool,
  });

  accumulateMetrics(row, singleTrace, splitTrace);
}

printComparisonTable(aggregates);
```

### Embedding modes

| Mode | When | How |
| --- | --- | --- |
| Live | Local dev / one-off runs | Real `embedQuery` via agent LLM config |
| Fixture | CI smoke test | Pre-recorded `situationVector` / `evidenceVector` per row in JSONL or sidecar file; `embedQuery` double returns cached values |

Pin `index_meta.provider`, `index_meta.model`, and `index_meta.dimensions` in
report output. Results are **not portable** across embed models.

---

## File checklist

- [ ] `agent/src/context/retrievalEvalCli.ts` — CLI entry + metric aggregation
- [ ] `agent/src/context/retrievalEvalCli.test.ts` — smoke test on sample fixture (frozen embeds)
- [ ] `agent/src/context/__fixtures__/phase2-eval.sample.jsonl` — one redacted labeled row
- [ ] `agent/package.json` — `"eval:retrieval": "tsx src/context/retrievalEvalCli.ts"`
- [ ] `distill/data/eval/phase2.jsonl` — full labeled set (local, gitignored)
- [ ] Optional: `distill/data/eval/phase2-embeddings.json` — frozen query vectors keyed by row `id`

---

## Example output

```
Phase 2 retrieval eval — gemini/text-embedding-004, k=5, minScore=0.3, recallN=20
Dataset: distill/data/eval/phase2.jsonl (32 rows)

                        single          split           delta
─────────────────────────────────────────────────────────────
Recall@20               0.78            0.81            +0.03
Precision@5             0.62            0.65            +0.03
MRR                     0.71            0.74            +0.03
Abstention accuracy     1.00            1.00             —
Safety pass rate        1.00            1.00             —
Evidence separation     n/a             0.18            (applicable − hard neg)

Verdict: PASS
```

---

## What changes in production if eval passes

| Change | Notes |
| --- | --- |
| Default `LINKROWTH_RETRIEVAL_STRATEGY` → `split` | Opt-in today |
| Tune `LINKROWTH_RETRIEVAL_CANDIDATE_POOL` | From recall curves, not `k * 4` placeholder |
| Rebuild prod index as v2 | Required for split |

**Does not change:** evidence score gating (Phase 4), pipeline ordering, or
`evaluateHits()` eligibility rules.

---

## CI integration (later)

1. Smoke test runs on `phase2-eval.sample.jsonl` with `--fixture`
2. Asserts harness exits 0 and safety pass rate = 1.0
3. Optionally assert recall@N on the single fixture row does not regress vs a
   frozen baseline snapshot

No live embed API calls in CI.

---

## Related files

| File | Role |
| --- | --- |
| `agent/src/context/retrieveContext.ts` | Strategy dispatch, trace emission |
| `agent/src/context/retrieveContext.test.ts` | Injection pattern for harness |
| `agent/src/context/experience/select.ts` | `evaluateHits()` — shared filters |
| `agent/src/context/queryConstruction.ts` | `buildEvidenceQuery` |
| `distill/src/index/store.ts` | v2 index build |
| `docs/retrieval-phase-2-plan.md` | Parent phase plan |
