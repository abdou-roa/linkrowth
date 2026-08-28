# Retrieval Matching — Current Baseline and Proposed Design

This document records the retrieval-matching review for Linkrowth. It separates
the behavior that exists today from proposed changes intended to improve how a
LinkedIn post and its planned comment angle are matched to claimable
engineering experience.

For the end-to-end implementation as it exists today, see
[`retrieval-layer.md`](./retrieval-layer.md). For artifact production and field
semantics, see [`distillation.md`](./distillation.md).

---

## Decision summary

Keep cosine similarity as the semantic similarity primitive. Both supported
embedding providers are designed for semantic retrieval, and replacing cosine
with Euclidean distance or raw dot product would not solve the main matching
problem.

The limitation is the input and ranking design around cosine:

- one vector currently flattens fields with different meanings;
- exact domain and technology terms have no dedicated lexical channel;
- eligibility is applied after a capped ranking result;
- the fixed score floor is not calibrated by provider and model;
- one score cannot distinguish "same situation" from "usable evidence."

The proposed direction is therefore a schema-aware, staged retrieval flow:

1. filter ineligible artifacts before candidate generation;
2. generate a broad candidate set using semantic search and lexical search;
3. combine their rank positions with Reciprocal Rank Fusion (RRF);
4. let the analyzer produce the intended problem, response intent, and comment
   angle;
5. rerank the shortlist against both the original post and that analysis;
6. inject only candidates that pass the existing truth constraints.

Broad deterministic candidate generation depends only on the post, so it can
run before or alongside analysis. Claim selection must wait for analysis:
relevance is not only "does this artifact resemble the post?" but also "does
this evidence support the response the agent intends to make?"

This is a design proposal, not a description of already-shipped behavior.

---

## What is implemented today

### Artifact representation

Each `ExperienceArtifact` contains:

| Field group | Fields | Current role |
| --- | --- | --- |
| Semantic experience | `title`, `problem`, `approach`, `tradeoff`, `claimableLine` | Included in one embedding |
| Categorical tags | `domains`, `stack` | Included as plain text in the same embedding |
| Lexical hints | `paths` | Up to 24 paths included in the same embedding |
| Eligibility | `shareability`, `confidence` | Excluded from the embedding; filtered after ranking |
| Provenance | `id`, `source`, `repo`, `implementationDate` | Stored but excluded from the embedding |

`retrievalText()` concatenates the included fields into one unweighted text
block. The index stores one vector and the full artifact JSON per experience.

### Runtime matching

The runtime query is the post body plus the author's headline when available.
The agent embeds that query, computes cosine similarity against every artifact
vector, sorts descending, and keeps `k × 3` raw hits.

After ranking, it removes:

- `private` artifacts;
- `low`-confidence artifacts;
- hits below `LINKROWTH_RETRIEVAL_MIN_SCORE` (default `0.3`);
- artifacts without a non-empty `claimableLine`.

It then injects at most `LINKROWTH_RETRIEVAL_K` claimable lines into
`UserContext.proofPoints`.

This entire retrieval and selection pass currently happens in
`runEngageWithStatus()` before `MultiStepEngageAgent.run()` starts. The
multi-step agent then runs:

```text
analyzer → [HITL if needed] → drafter → refiner ↺ drafter
```

The analyzer therefore does not yet provide input to retrieval ranking. It
receives an already-enriched `UserContext`, even though its current prompt uses
persona fields rather than the retrieved `proofPoints`. The proposed behavior
changes this ordering; it is not a small scoring change inside the existing
`retrieveContext()` call.

### What the baseline gets right

- Cosine similarity is appropriate for comparing the configured embeddings.
- Gemini correctly uses asymmetric `RETRIEVAL_DOCUMENT` and
  `RETRIEVAL_QUERY` task types.
- Brute-force ranking is simple and sufficient for the current index size.
- Truth and privacy filters prevent unsafe proof points from being injected.
- Retrieval degrades gracefully when the index or embedding provider fails.

---

## Why one cosine score is insufficient

The current vector mixes information that answers different questions:

```text
title + domains + stack + problem
    "Is this the same kind of situation?"

approach + tradeoff + claimableLine
    "Is this experience useful evidence for this post?"

paths
    "Do implementation terms overlap?"
```

Flattening all three into one vector creates several failure modes.

### Field dilution

A strong problem match can be weakened by unrelated path names or a long
approach description. Conversely, shared infrastructure terms can make an
artifact look relevant even when it solved a different problem.

### Lost exact matches

Embeddings are good at conceptual similarity but are not guaranteed to reward
exact strings such as a library name, database feature, protocol, or acronym.
Those terms can be decisive when choosing between otherwise similar
experiences.

### Candidate starvation

The current flow ranks all artifacts, takes only `k × 3`, and then applies
eligibility filters. Private or low-confidence hits can occupy that capped
window, leaving fewer eligible candidates even when relevant public artifacts
exist lower in the ranking.

### Uncalibrated thresholds

A cosine score is meaningful only in the context of its provider, model,
query distribution, and document construction. A universal `0.3` threshold is
a reasonable safety default, but it is not evidence that a candidate is
relevant for every configured model.

---

## Proposed index representation

Store two semantic vectors per eligible artifact and a lexical representation
for exact-term retrieval.

### Situation vector

Answers: **Does this experience concern the same situation?**

```text
title
domains
stack
problem
```

This vector should drive high-recall semantic candidate generation.

### Evidence vector

Answers: **Is the resulting experience applicable as evidence?**

```text
approach
tradeoff
claimableLine
```

This vector is a post-analysis reranking signal. It must not be a hard gate by
itself: a post may describe only a problem and omit the solution language
present in a valid experience. The analyzer's intended response angle supplies
additional applicability context without changing what the artifact proves.

### Lexical document

Supports exact matching with BM25:

```text
title
domains
stack
problem
approach
selected path terms
```

SQLite FTS5 is a natural fit because the experience index is already SQLite.
Fields should be indexed with explicit weights or separate columns so path
tokens cannot dominate domain, stack, or problem matches.

### Eligibility and provenance

`shareability`, `confidence`, and a non-empty `claimableLine` remain hard
constraints, not ranking features. Provenance remains available for
observability and tie-breaking but must not imply relevance.

The index is reproducible offline data, so this change should use an explicit
schema version and a full rebuild rather than attempting to reinterpret the
existing `vector` column. The agent should reject an incompatible index
clearly and continue with static context.

---

## Proposed query-time flow

```text
post body + author headline
        │
        ├─────────────────────────────────────────────┐
        │                                             │
        ▼                                             ▼
deterministic candidate generation                 analyzer
  ├─ situation cosine                                │
  ├─ BM25 lexical search                             ├─ problem / thesis
  └─ RRF fusion                                      ├─ response intent
        │                                             └─ comment angle
        ▼                                             │
 broad fused shortlist                               │
        │                                             │
        └──────────────────────┬──────────────────────┘
                               ▼
                 post-analysis reranking
             original post + structured analysis
               + situation/evidence signals
                               │
                               ▼
                  calibrated accept / abstain
                               │
                               ▼
                    claimableLine selection
                               │
                               ▼
                       drafter → refiner
```

The two top branches can run sequentially or concurrently. Their synchronization
point is mandatory: reranking cannot begin until both the broad shortlist and a
completed `AnalysisArtifact` are available.

### Step 1: prefilter eligibility

Exclude `private`, `low`-confidence, and empty-claim artifacts before applying
candidate limits. This preserves the existing safety boundary while preventing
ineligible rows from consuming retrieval capacity.

The full artifact can remain in the index for auditing if needed, but it must
not enter an injectable candidate list.

### Step 2: semantic candidate generation

Rank eligible situation vectors by cosine similarity. Optimize this stage for
recall by retrieving a broader pool than the final `k`; the exact pool size
must come from evaluation rather than the current `k × 3` heuristic.

Cosine remains the score within this semantic channel.

### Step 3: lexical candidate generation

Run a BM25 search over the lexical representation. This channel recovers exact
technology, acronym, domain, and implementation-term matches that embedding
similarity may underweight.

BM25 and cosine values must not be added directly. They have unrelated scales:
a cosine value such as `0.72` and a BM25 value such as `11.4` are not
comparable.

### Step 4: Reciprocal Rank Fusion

RRF combines rank positions instead of incompatible raw scores:

```text
rrf(candidate) =
  1 / (c + semanticRank)
  + 1 / (c + lexicalRank)
```

A candidate that ranks well in both channels rises above candidates supported
by only one weak signal. Candidates present in only one list can still survive,
which preserves recall.

The rank constant `c`, per-channel candidate counts, and tie-breaking rules
must be explicit configuration recorded in retrieval traces and selected by
benchmark results.

### Step 5: produce structured response analysis

Run the analyzer before final retrieval selection. Its `AnalysisArtifact`
already carries structured signals that can be mapped into retrieval intent:

- **Problem / thesis** — `coreThesis`, relevant `postQuestions`, and
  `unspokenTradeoffs`;
- **Response intent** — questions marked for answering, `category`, and desired
  response parameters;
- **Comment angle** — `pivotStrategy.acknowledgedPoint` and
  `pivotStrategy.insightDirection`.

Candidate generation does not need these fields and should not wait on them
when parallel execution is useful. Reranking and claim selection do.

If analysis pauses for human clarification, do not draft or finalize proof
points. On resume, use the checkpointed analysis plus the authoritative answer
when constructing reranking intent. Candidate generation may be reused only
when its post and index version still match.

### Step 6: schema-aware reranking

Rerank only the fused shortlist, using the original post and the structured
analysis together. The original post remains necessary ground truth; analysis
is a fallible interpretation and cannot replace it. The reranker evaluates:

1. **Situation fit** — the artifact concerns the same problem, domain, and
   operating context expressed by the post.
2. **Angle fit** — the experience helps execute the analyzer's intended
   response or answer an identified question, rather than pulling the draft
   toward a different topic.
3. **Evidence applicability** — the approach and tradeoff support a useful
   response given both the post and intended angle.
4. **Claim alignment** — the `claimableLine` follows from the artifact and is
   relevant to the post-analysis pair.
5. **Contradiction or overreach** — neither the post nor analysis justifies
   stretching the artifact beyond what it records.

The first implementation should use inspectable signals: situation cosine,
evidence cosine against a deterministic analysis-derived query, RRF rank, and
exact domain/stack overlap. It should record which post and analysis fields
produced each signal. Do not invent a weighted sum without labeled evaluation
data.

An LLM or cross-encoder reranker is a later option, not a prerequisite. It adds
latency, cost, and nondeterminism, so it should be introduced only if the
deterministic hybrid baseline leaves measurable ranking errors. If introduced,
it should return structured fit reasons and an abstain decision, not rewrite
the claim.

Analysis is relevance context, not evidence. A statement in
`AnalysisArtifact` cannot establish that the user built, operated, measured, or
observed anything. Only the distilled `ExperienceArtifact` can support a
claimable line, and the reranker may select or reject that line but never
expand its factual scope.

### Step 7: calibrated selection

Apply model-specific acceptance criteria to the reranked list and keep the
existing final eligibility checks as defense in depth. Returning no retrieved
proof point is correct when no candidate is sufficiently relevant.

The final selector should cap at `k`, deduplicate claimable lines, and preserve
static proof points exactly as it does today. Only after this selection should
the enriched context be supplied to the drafter and refiner.

### Required integration change

The current `runEngageWithStatus()` call to `retrieveContext(post, baseContext)`
bundles candidate generation, ranking, filtering, and proof-point injection
before the agent runs. The proposal requires splitting that operation into two
contracts:

```text
generateCandidates(post, index) → fused shortlist

selectForAnalysis(post, analysis, shortlist, baseContext)
  → enriched context + ranking trace
```

The multi-step orchestrator needs a synchronization stage after analyzer/HITL
handling and before the first drafter call. `runEngageWithStatus()` can load the
base persona and initiate deterministic candidate generation, but it cannot
finalize retrieved `proofPoints` because it does not yet have the analyzer
output. On resume, the same stage must accept the checkpointed analysis and
clarification before drafting.

This preserves the context/retrieval module as the owner of matching logic
while moving final selection to the point in the pipeline where all relevance
inputs exist.

---

## Example

Post:

```text
Our background jobs sometimes disappear without an error. How are teams
handling durable retries without adding Kafka?
```

Analyzer output (abridged):

```text
problem / thesis: Silent job loss makes retry behavior untrustworthy.
response intent: Answer with a concrete durability pattern that avoids Kafka.
comment angle: Acknowledge the operational pain, then offer a smaller-system
               pattern based on explicit delivery acknowledgement.
```

Candidate A:

```text
problem: Tasks were silently lost under load.
approach: Replaced the queue with Redis Streams and explicit acknowledgements.
claimableLine: I replaced a lossy queue with Redis Streams to make retries durable.
```

Candidate B:

```text
problem: Redis API latency increased during peak traffic.
approach: Added connection pooling and response caching.
claimableLine: I reduced Redis latency with connection pooling.
```

Both may receive semantic credit for "Redis." Candidate A should win because:

- its situation vector matches disappearing background jobs;
- its lexical document matches jobs, retries, and durability;
- its evidence supports the analyzer's explicit-acknowledgement angle;
- its claim supports that response while staying grounded in the artifact.

Candidate B illustrates why one flattened cosine score can overvalue shared
technology while missing problem, intended-angle, and evidence alignment. If
the analyzer instead selected a performance-tuning angle, Candidate B might
become more relevant, but analysis alone still could not make its latency claim
true; the artifact would remain the evidence.

---

## Behavioral impact

| Area | Current behavior | Proposed behavior |
| --- | --- | --- |
| Semantic scoring | One cosine score over all embedded fields | Separate situation and evidence signals |
| Exact terms | Only indirectly represented in embeddings | Dedicated BM25 lexical channel |
| Score combination | Not applicable | RRF combines channel ranks, not raw scores |
| Eligibility | Applied after a capped raw ranking | Applied before candidate limits and again before injection |
| Threshold | Global cosine floor, default `0.3` | Provider/model-calibrated accept or abstain criteria |
| Candidate count | `k × 3` | Recall-driven pool size selected by evaluation |
| Pipeline position | Retrieval and injection finish before analyzer | Candidate generation before/alongside analyzer; reranking and selection after analysis, before drafter |
| Reranking | None | Original-post + analysis-aware deterministic rerank; optional model reranker later |
| Storage | One vector plus artifact JSON | Two vectors, lexical index, artifact JSON, schema version |
| Failure behavior | Falls back to static context | Same graceful fallback |

Expected benefits:

- fewer matches based only on shared technology or path vocabulary;
- better recovery of exact stack and domain terms;
- fewer eligible results lost behind private or low-confidence rows;
- proof points selected for the actual planned comment angle;
- clearer reasons for why a proof point was selected;
- safer abstention when no experience genuinely applies.

Expected costs:

- roughly doubled vector storage;
- additional index-build work and an FTS query at runtime;
- more ranking parameters to evaluate and version;
- reranker latency and cost if a model-based stage is eventually enabled.

---

## Validation plan

Matching changes should be evaluated against labeled triples of real posts,
analysis outputs, and experience artifacts. Hand-picked demonstrations are
useful for debugging but are not enough to choose weights or thresholds.

### Dataset

For each post-analysis pair, label:

- artifacts that are relevant situations;
- artifacts that support the selected response intent and angle;
- artifacts whose evidence is applicable;
- artifacts that are safe to inject;
- cases where retrieval should abstain;
- hard negatives that share stack terms but solve a different problem.

Include posts with exact technology names, conceptual matches without shared
vocabulary, problem-only wording, and no matching experience. Include multiple
plausible angles for the same post to verify that reranking responds to intent
without treating analysis as factual evidence.

### Offline metrics

| Metric | Purpose |
| --- | --- |
| Recall@candidate-N | Did candidate generation retain relevant experiences? |
| Precision@k | How many final results are genuinely usable? |
| MRR or nDCG | Did the best evidence rank near the top? |
| Angle-conditioned precision | Do selected experiences support the analyzed response angle? |
| Abstention accuracy | Does retrieval avoid injecting on no-match posts? |
| Safety-filter pass rate | Are private, low-confidence, and empty claims always excluded? |

Track results by provider and embedding model. A threshold or rank configuration
validated for one model must not silently carry over to another.

### Runtime metrics

Record:

- index schema, provider, model, and dimensions;
- semantic and lexical ranks;
- situation and evidence scores;
- analysis schema/version and the fields used to derive reranking intent;
- eligibility decisions and drop reasons;
- final selected artifact IDs;
- candidate-generation, analyzer wait, rerank, and total retrieval latency;
- model reranker cost when applicable.

Do not persist vectors in traces. Artifact IDs and scalar signals are enough to
reconstruct ranking decisions against a versioned index.

### Acceptance criteria

Before rollout, the proposed pipeline should:

1. improve precision@k and top-rank quality over the current cosine baseline;
2. preserve or improve candidate recall;
3. improve angle-conditioned precision over post-only ranking;
4. achieve 100% exclusion of private, low-confidence, and empty-claim
   artifacts in safety tests;
5. prove that analyzer-only statements never become claimable evidence;
6. improve abstention accuracy rather than increasing irrelevant injections;
7. stay within an agreed retrieval latency budget;
8. preserve graceful fallback when the index, FTS data, or embedding call is
   unavailable.

---

## Incremental rollout

### Phase 0: establish the baseline

- version retrieval traces and index metadata;
- build the labeled evaluation set;
- measure the current single-vector cosine pipeline.

This phase is required before tuning thresholds or weights.

### Phase 1: fix candidate eligibility

- prefilter non-injectable artifacts before candidate limits;
- retain the existing final filters as defense in depth;
- replace unexplained `k × 3` over-fetching with an evaluated candidate count.

This is independently useful and does not require a new similarity technique.

### Phase 2: split semantic fields

- build situation and evidence vectors;
- version and rebuild the SQLite index;
- retrieve broad candidates by situation cosine;
- define the deterministic analysis-derived query used later for evidence
  scoring;
- compare against the baseline before changing production selection.

### Phase 3: add lexical retrieval and RRF

- create the FTS5 lexical index;
- retrieve semantic and BM25 candidate lists;
- fuse ranks with RRF;
- tune candidate counts and the RRF constant on the labeled set.

### Phase 4: add structured reranking

- split pre-analysis candidate generation from post-analysis selection;
- add a multi-step synchronization stage after analyzer/HITL and before
  drafter;
- rerank with the original post, structured analysis, and deterministic,
  observable ranking signals;
- calibrate selection and abstention by provider/model;
- verify resume behavior with checkpointed analysis and clarification.

### Phase 5: consider a model reranker

- add an LLM or cross-encoder only when evaluation shows a remaining gap;
- require structured reasons and abstention;
- keep the original post and artifact as factual boundaries.

Each phase should be deployable behind a strategy flag so the current baseline
can be compared and restored without rebuilding application code.

---

## Non-goals

- Replacing cosine with another vector-distance formula without evidence.
- Adding an approximate-nearest-neighbor service while the index remains small.
- Allowing ranking quality to weaken privacy or confidence constraints.
- Treating an LLM reranker as the source of truth for whether an experience
  happened.
- Treating analyzer output as proof that an experience or result happened.
- Assigning permanent score weights based on intuition alone.

The artifact remains the source of truth. Retrieval only decides which
already-distilled, claimable experience is relevant enough for the analyzed
comment angle and safe to offer to the drafter and refiner.
