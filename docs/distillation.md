# Distillation — Offline Experience Artifacts

Distillation is the **offline LLM pass** that turns sanitized engineering history (commits, PRs) into structured **Experience Artifacts**. Those artifacts are what get embedded later — never raw commit bodies or PR diffs.

This package lives entirely in `distill/`. It is **not** on the engage hot path. Run it as a batch worker on a machine that can read local clones and/or call GitHub.

For how artifacts are searched at runtime, see [`retrieval-layer.md`](./retrieval-layer.md).

---

## Where distillation sits in the pipeline

```text
[ Extract ]
  local git  → data/raw-local-git-logs.json
  GitHub PRs → data/raw-prs.json
        ↓ adapters (src/adapt/)
[ Sanitize ]
  → data/candidates.sanitized.json
  → data/candidates.dropped.json
        ↓ LLM distill (this doc)
[ Distill ]
  → data/artifacts.json
  → data/artifacts.dropped.json
        ↓ embeddings (see retrieval-layer.md)
[ Index ]
  → data/experience-index.db
```

**Hard boundary:** distill writes only under `distill/data/` (gitignored). It never imports `agent/`, `api/`, or `extension/`. The agent later reads only `experience-index.db`.

---

## Inputs and outputs

| Stage | File | Type |
|---|---|---|
| Input | `data/candidates.sanitized.json` | `RawExperienceCandidate[]` |
| Output (kept) | `data/artifacts.json` | `ExperienceArtifact[]` |
| Output (dropped) | `data/artifacts.dropped.json` | `DistillDropRecord[]` |

Run order:

```bash
cd distill
npm run extract:local    # or extract:github
npm run sanitize
npm run distill            # ← this stage
npm run index              # embed artifacts → SQLite (separate doc)
```

---

## What a candidate looks like (before distillation)

A `RawExperienceCandidate` (`distill/src/types.ts`) is source-agnostic history after extract + sanitize:

```ts
interface RawExperienceCandidate {
  id: string;                    // deterministic across re-runs
  source: "github_pr" | "local_git" | "cursor_chat";
  repo: string;
  implementationDate: string;    // ISO-8601
  title: string;
  body: string;
  paths: string[];               // changed paths only — never patch hunks
  discussion?: DiscussionItem[];
  meta: Record<string, string | number | boolean | null>;
}
```

Sanitize (`npm run sanitize`) already dropped bot commits, trivial titles, lockfile-only changes, etc. Distillation assumes the candidate is worth considering — but the LLM may still reject it.

---

## What an artifact looks like (after distillation)

An `ExperienceArtifact` is the structured, claimable unit of experience:

```ts
interface ExperienceArtifact {
  id: string;                    // same as candidate id
  sourceCandidateId: string;
  source: ExperienceSource;
  repo: string;
  implementationDate: string;
  title: string;
  domains: string[];             // kebab-case retrieval tags, max 8
  stack: string[];               // technologies, max 8
  problem: string;
  approach: string;
  tradeoff: string;
  claimableLine: string;         // one sentence the author can say in a comment
  confidence: "high" | "medium" | "low";
  shareability: "public" | "anonymized" | "private";
  paths: string[];               // copied from candidate
}
```

**Important:** the artifact JSON is stored in the index DB for read-back, but **is not embedded as JSON**. Indexing concatenates selected fields into plain text via `retrievalText()` — see [`retrieval-layer.md`](./retrieval-layer.md#what-gets-embedded).

---

## Distillation flow (step by step)

### 1. Load candidates and existing artifacts

`distill/src/distill/run.ts`:

- Reads `data/candidates.sanitized.json`
- Loads existing `data/artifacts.json` (if any)
- Calls `distillCandidates(candidates, { call, existingArtifacts, onProgress })`

### 2. Skip already-distilled ids (unless forced)

`distill/src/distill/engine.ts`:

- By default, candidates whose `id` is already in `artifacts.json` are **skipped**
- Set `DISTILL_FORCE=1` to re-distill everything (useful after prompt changes or to retry prior `D_drop`s)
- `DISTILL_LIMIT=N` caps how many new candidates are processed this run
- `DISTILL_CONCURRENCY` (default `3`) controls parallel LLM calls

### 3. Distill one candidate

`distill/src/distill/one.ts` → `distillOne()`:

1. **Optional diff fetch** — if the commit/PR body is under 80 characters (`needsCodeDiff`), load a bounded unified diff:
   - Local git: `git diff-tree`
   - GitHub PR: Files API
2. **Build prompt** — `buildDistillPrompt(candidate, { diff })` in `distill/src/distill/prompt.ts`
3. **LLM call** — provider-agnostic `call()` with `json: true`, `maxTokens: 800`
4. **Parse response** — `parseDistillResponse(raw, candidate)` in `distill/src/distill/parse.ts`
5. **Retry once** on invalid JSON (appends “return only the JSON object” to the user message)

### 4. Parse and validate the LLM response

The model returns **one JSON object**. Two outcomes:

**Drop:**

```json
{ "drop": true, "reason": "<short reason>" }
```

Recorded as `D_drop` in `artifacts.dropped.json`.

**Artifact:**

```json
{
  "title": "...",
  "domains": ["kebab-case-tag"],
  "stack": ["Node.js", "Redis"],
  "problem": "...",
  "approach": "...",
  "tradeoff": "...",
  "claimableLine": "...",
  "confidence": "high" | "medium" | "low",
  "shareability": "public" | "anonymized" | "private"
}
```

Post-parse validation in `parseDistillResponse()` — drops with specific rules:

| Rule | When |
|---|---|
| `D_drop` | Model returned `{ drop: true }` |
| `D_unclaimable` | Empty `claimableLine` |
| `D_unclaimable` | Both `problem` and `approach` empty |
| `D_private` | `shareability === "private"` |
| `D_parse` | Invalid JSON after retry |
| `D_call` | LLM API failure after retry |

Fields like `id`, `source`, `repo`, `implementationDate`, and `paths` are **not** model-generated — they are copied from the candidate for determinism.

### 5. Write outputs

`run.ts` writes:

- `artifacts.json` — `{ distilledAt, count, artifacts[] }`
- `artifacts.dropped.json` — `{ distilledAt, count, dropped[] }`

---

## Prompt design (what the LLM sees)

System instructions (`distill/src/distill/prompt.ts`) tell the model to:

- Distill one candidate into a single Experience Artifact for LinkedIn comment retrieval
- Treat **code diff as primary evidence** when the body is short or empty
- **Not** drop just because the body is empty — infer from diff + paths
- Drop only for genuinely unclaimable work (lockfile/formatting-only, secrets, un-anonymizable client work)
- Never invent metrics, customers, or outcomes
- Anonymize client/employer names unless clearly public work
- Produce a `claimableLine` the author could actually say

User message includes:

```text
Source, repo, date, id
Title
Body (truncated to 4000 chars)
Changed paths (max 40)
Discussion (max 20 items, 500 chars each)
Code changes section (when body is short) — bounded unified diff
```

---

## Short-body / diff behavior

Many local git commits have subject-only messages. Distillation handles this explicitly:

| Condition | Behavior |
|---|---|
| Body ≥ 80 chars | Distill from title + body + paths + discussion |
| Body < 80 chars | Fetch bounded diff; model treats diff as primary evidence |
| Diff unavailable | Prompt says to infer from paths + title; do not drop solely for empty body |

This is controlled by `needsCodeDiff()` and `loadCodeDiff()` in `distill/src/distill/diff.ts`.

---

## LLM provider configuration

Distill uses its own copy of the LLM layer (`distill/src/llm/`) — same `call()` contract as `agent/src/llm`, but no cross-package imports.

| Env var | Purpose | Default |
|---|---|---|
| `LINKROWTH_PROVIDER` | `openai` or `gemini` | `openai` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Provider API key | — |
| `LINKROWTH_OPENAI_MODEL` / `LINKROWTH_GEMINI_MODEL` | Distill chat model | `gpt-4o-mini` / `gemini-2.5-flash` |

Distillation uses the **chat** model (`call()`), not the embed model. Embedding happens in the separate `npm run index` step.

---

## Debugging distillation

### Nothing in `artifacts.json`

1. Did sanitize produce candidates? Check `data/candidates.sanitized.json`
2. Are all ids already distilled? Delete ids from `artifacts.json` or use `DISTILL_FORCE=1`
3. Check `artifacts.dropped.json` for drop reasons

### Too many `D_drop`

- Read `detail` / `reason` in dropped records
- Short commits: verify diff is loading (`needsCodeDiff` path)
- Re-run with `DISTILL_FORCE=1` after prompt changes

### Artifacts look wrong (hallucinated, too vague)

- Inspect the candidate in `candidates.sanitized.json` — distill only sees that evidence
- Check whether diff was included (short-body path)
- Adjust prompt only in `distill/src/distill/prompt.ts` — changes require re-distill

### Re-distill specific ids

Either:

- Remove those ids from `artifacts.json`, then `npm run distill`
- Or `DISTILL_FORCE=1 npm run distill` (re-processes all candidates)

After any artifact change, **rebuild the index**: `npm run index` (see retrieval doc).

---

## Key source files

| File | Role |
|---|---|
| `distill/src/distill/run.ts` | CLI entry, reads/writes JSON files |
| `distill/src/distill/engine.ts` | Batch orchestration, skip logic, concurrency |
| `distill/src/distill/one.ts` | Single-candidate distill + retry |
| `distill/src/distill/prompt.ts` | System + user prompt construction |
| `distill/src/distill/parse.ts` | JSON parse, validation, drop rules |
| `distill/src/distill/diff.ts` | Short-body diff loading |
| `distill/src/types.ts` | `RawExperienceCandidate`, `ExperienceArtifact` |
| `distill/README.md` | Quick-start commands (links here for depth) |

---

## Related docs

- [`retrieval-layer.md`](./retrieval-layer.md) — embedding, indexing, cosine search, query-time retrieval
- [`distill/README.md`](../distill/README.md) — setup and commands
