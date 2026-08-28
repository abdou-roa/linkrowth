# Distill — GitHub Ingestion Pipeline

> Living document. Validated design for the offline Extract stage under `distill/`. No implementation yet.

**Last updated:** 2026-08-25  
**Status:** Design locked pending open questions (§8). Coding starts after those are answered.  
**Related:** [`distill/README.md`](../distill/README.md), [`docs/distillation.md`](./distillation.md), [`docs/retrieval-layer.md`](./retrieval-layer.md).

---

## 0. Objective

Headless, backend-to-backend extraction of high-signal engineering history from GitHub for Linkrowth’s offline knowledge distillation pipeline.

**In scope for this doc:** ingestion only — GraphQL extract → deterministic sanitize → `distill/data/raw-prs.json`.  
**Out of scope here:** LLM distillation, embeddings, vector index, OAuth, Cursor log extract, `retrieveContext` in `agent/`.

---

## 1. Package boundary

| Package | Role |
|---|---|
| `agent/` | Online engage + later read of indexed store |
| `api/` / `extension/` | Online gateway / UI |
| **`distill/`** | **Offline: extract → distill → embed / index** |

Hard rules (from `distill/README.md`):

- Distill writes under `distill/data/` (gitignored).
- Distill never imports engage / API / extension.
- Agent never imports distill extractors — only the indexed store later.

---

## 2. Full pipeline (context)

```text
[ Extract ]                         [ Distill ]              [ Index ]
GitHub merged PRs  ──────────────►  LLM → Experience   ──►  embeddings +
  (+ reviews / discussion,           Artifact (Zod)          local vector DB
   no diff hunks)                    + human review
Cursor chat logs ────────────────►
```

This document covers **Extract** for GitHub only.

### Source priorities (unchanged)

1. **PR descriptions** — primary Git source (“why”); no per-commit patches.
2. **Cursor chat logs** — architectural debate / failure modes (separate extractor).
3. **Commit messages** — optional catalog/metadata only; never feed patches to the LLM.

---

## 3. Auth & repo access (v1)

| Concern | Decision |
|---|---|
| Auth | Fine-grained **Personal Access Token** first; OAuth later (same extract shape) |
| Repo scope | **Only select repositories** — no broad account crawl |
| Permissions (read-only) | `Pull requests`, `Issues`, `Metadata` |
| Config (v1) | `GITHUB_TOKEN` in `distill/.env` + repo list in `distill/config/repos.github.json` |

**Complementary path:** If a repo is **no longer** reachable via GitHub API (deleted remote, lost org access, etc.), use **local Git extract** instead — see [`local-git-ingestion-spec.md`](./local-git-ingestion-spec.md) §1.1. That path uses `git -C <absolute-path> log` on clones already on disk; no HTML scraping and no API.

---

## 4. Data hierarchy & GraphQL mental model

```text
Repository (nameWithOwner, defaultBranch)
 └── Pull Request (id, title, body, state: MERGED, mergedAt, createdAt, author)
      ├── files summary (path, additions, deletions) — for lockfile/asset-only filter
      ├── Issue Comments (top-level PR discussion)
      └── Code Reviews (APPROVED / CHANGES_REQUESTED / …)
           └── Review Comments (body, path, optional line — **no diff hunks**)
```

**API choice:** GraphQL for nested PR → comments → reviews → review comments with pagination. REST is fallback only.

### Field → distillation signal

| Field / object | Signal | ETL use |
|---|---|---|
| `PullRequest.title` + `body` | Problem statement, rationale, solution design | Maps to `problem` / `tradeoff` |
| `PullRequest.mergedAt` | Production / implementation timestamp (ISO-8601) | `implementationDate` for recency |
| `PullRequest.reviews` | Peer critique, trade-offs, approvals | Edge cases / alternatives |
| Review comments (in-line) | Execution detail, error handling, performance | Feeds `rootCause` (and optional `failureMode`) |
| Issue comments on the PR | Investigation threads, debugging, post-mortems | Troubleshooting methodology |

### Diff policy (locked)

- **Ingest:** review comment **body** + `path` + optional line anchors.
- **Do not ingest:** diff hunks / patch text.
- Aligns with README “file stats — no diffs” while keeping review signal.

### Issues scope (locked for v1)

- **In:** conversation on **merged PRs** (issue comments on the PR).
- **Out:** standalone Issues with no linked merged PR (weaker `implementationDate`, more noise). Revisit later.

---

## 5. Timestamps & recency

| Timestamp | Meaning |
|---|---|
| `mergedAt` | **Implementation date** — production anchor; filter `state: MERGED` only |
| `createdAt` | When the proposal / discussion started |
| Review / comment `createdAt` | Timing of specific debates |

Downstream (Index, not Extract): preserve `implementationDate` in vector metadata for:

- Recency decay / weighting
- Deprecation gating (prefer newer architectures over obsolete ones)

---

## 6. Noise pruning (deterministic, pre-LLM)

Applied in Extract **before** any distillation worker sees the payload.

### Drop automated / low-value PRs

- Automated merge commit titles (e.g. `Merge branch 'main'`).
- Dependency bump bots (`dependabot`, `renovate`, GraphQL `Bot` authors + login denylist).
- Changes touching **solely** lockfiles, `.gitignore`, or asset-only paths (needs files summary).

### Drop low-information comments

- Trimmed body length &lt; 20 characters (e.g. `LGTM`, `fixed`, `done`).
- Linter / formatting bot comments (same bot filter).

Optional later: minimum PR body length (empty “fix typo” merges).

---

## 7. Distillation target schema (downstream)

Extract does **not** produce this. Distill turns sanitized PR records into Experience Artifacts:

```json
{
  "id": "exp_unique_id",
  "valid": true,
  "topic": "caching | rate-limiting | ingestion-pipeline | state-machine",
  "tools": ["redis", "graphql", "fastify"],
  "problem": "Production bottleneck or challenge encountered",
  "rootCause": "Underlying mechanism causing the issue",
  "tradeoff": "Engineering compromise or architectural decision made",
  "takeaway": "Core takeaway or rule of thumb",
  "implementationDate": "2026-04-12T10:30:00Z"
}
```

| Rule | Detail |
|---|---|
| `implementationDate` | On the artifact **and** vector-store metadata |
| `valid: false` | Keep in `experiences.json` for human review; **do not** index |
| `failureMode` | **Unresolved** — fold into `rootCause` vs optional field (§8) |

---

## 8. Open questions (answer before coding)

1. **Repos:** single repo for the first run, or a multi-repo list in config?
2. **Time window:** last N months (e.g. 12–24), or full merged history?
3. **Auth config:** is `GITHUB_TOKEN` + `GITHUB_REPOS=owner/repo,...` enough for v1?
4. **`failureMode`:** drop from the mapping, or add as an optional artifact field?

---

## 9. Proposed module layout (when coding starts)

```text
distill/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── extract-prs.ts          # orchestration + CLI
│   ├── github/
│   │   ├── client.ts           # token, GraphQL POST
│   │   ├── queries.ts          # paginated PR hierarchy
│   │   └── types.ts
│   ├── sanitize/
│   │   └── prune.ts            # deterministic filters
│   ├── schema.ts               # later — Experience Artifact Zod
│   ├── distill.ts              # later
│   └── embed-and-index.ts      # later
└── data/                       # gitignored
    └── raw-prs.json            # Extract output
```

### Extract v1 success criteria

- GraphQL query matches §4 hierarchy (merged PRs only, no hunks).
- Sanitizer strips bots / merge noise / lockfile-only / short comments.
- Writes `distill/data/raw-prs.json`.
- No LLM calls in this stage.

---

## 10. Explicitly out of v1

- OAuth / GitHub App install flow
- Standalone Issues
- Commit patches / diff hunks
- Cursor log extraction
- Distill / embed / index
- `agent` `retrieveContext`
