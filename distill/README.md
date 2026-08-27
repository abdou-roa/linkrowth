# Distill — Offline Experience Distillation

Offline batch package for Linkrowth. Extracts engineering history, sanitizes it into shared candidates, **distills** Experience Artifacts with an LLM, and **indexes** them as a local vector store.

This is **not** part of the suggestion hot path. Run it as its own worker on a machine that can read your clones and/or call GitHub.

## Access model (read this first)

| Source | How history is reached | Config |
|---|---|---|
| **Local Git** | Absolute paths to **other** checkouts on disk → `git -C <path> log …`. No HTML, no GitHub API. | `config/repos.local.json` |
| **GitHub** | Fine-grained PAT + GraphQL for selected `owner/name` repos still on GitHub. | `.env` (`GITHUB_TOKEN`) + `config/repos.github.json` |

Local extract never “finds” repos by itself. You list clones that already exist (client projects, old org tools, etc.). If a remote is gone but a clone remains, local extract still works. Online `engage()` does **not** shell into these repos — only this offline package does.

Details: [`docs/local-git-ingestion-spec.md`](../docs/local-git-ingestion-spec.md) §1.1, [`docs/DISTILL-GITHUB-INGESTION.md`](../docs/DISTILL-GITHUB-INGESTION.md), [`docs/DISTILL-SANITIZE-DISTILL-INDEX.md`](../docs/DISTILL-SANITIZE-DISTILL-INDEX.md).

## Hard boundary

- Writes under `distill/data/` (gitignored).
- Never imports `agent/` / `api/` / `extension/`.
- LLM helpers live in `src/llm/` (same `call()` contract as `agent/src/llm`, copied here so distill stays a separate worker).
- Agent later reads only `data/experience-index.db` — not extractors.

## Current status

| Stage | Status |
|---|---|
| Extract (local + GitHub) | Implemented |
| Sanitize / prune | Implemented |
| Distill (LLM) | Implemented |
| Embed / index | Implemented (local SQLite cosine store) |

## Pipeline

```text
[ Extract ]
  local  → data/raw-local-git-logs.json
  GitHub → data/raw-prs.json
        ↓ adapters
[ Sanitize ]
  → data/candidates.sanitized.json
  → data/candidates.dropped.json
        ↓ LLM (provider-agnostic call)
[ Distill ]
  → data/artifacts.json
  → data/artifacts.dropped.json
        ↓ embeddings
[ Index ]
  → data/experience-index.db
```

Distill is 1:1 per sanitized candidate. If the commit/PR **body is under 80 characters** (typical subject-only local git), distill fetches a **bounded unified diff** (`git diff-tree` for local; GitHub Files API for PRs) and treats that as primary evidence. The model may still **drop** a candidate (`D_drop` for trivial leftover, empty claimable line, or `shareability=private`). Re-runs skip ids already in `artifacts.json` unless `DISTILL_FORCE=1`.

To re-distill previous `D_drop`s after this change, run with `DISTILL_FORCE=1` (or delete those ids from `data/artifacts.json`).

The index embeds `title + domains + stack + problem + approach + tradeoff + claimableLine + paths` (never raw commit/PR bodies). Vectors and artifacts land in a local SQLite DB (`experience-index.db`); search is cosine similarity over those rows. Rebuild the index if you change provider or embed model.

## Setup

```bash
cd distill
cp .env.example .env                          # GITHUB_TOKEN + OPENAI_API_KEY or GEMINI_API_KEY
cp config/repos.local.example.json config/repos.local.json
cp config/repos.github.example.json config/repos.github.json
# Edit repos.local.json with absolute paths + your git author string
# Edit repos.github.json with owner/name list
npm install
```

## Commands

```bash
npm run extract:local    # → data/raw-local-git-logs.json
npm run extract:github   # → data/raw-prs.json
npm run sanitize         # adapters + prune → data/candidates.sanitized.json
                         # (+ data/candidates.dropped.json)
npm run distill          # LLM → data/artifacts.json (+ artifacts.dropped.json)
npm run index            # embed → data/experience-index.db
npm run search -- "postgres suggestion jobs"
npm test
```

Optional env: `DISTILL_LIMIT` (cap candidates this run), `DISTILL_CONCURRENCY` (default 3), `DISTILL_FORCE=1` (re-distill existing ids, including prior empty-body `D_drop`s), `SEARCH_K` (default 5).

## Layout

```text
distill/
├── package.json
├── tsconfig.json
├── .env.example
├── config/
│   ├── repos.local.example.json
│   └── repos.github.example.json
├── src/
│   ├── extract-local-git.ts
│   ├── extract-prs.ts
│   ├── adapt/
│   ├── config/
│   ├── distill/
│   ├── github/
│   ├── index/
│   ├── llm/               # call() + embed() — mirrors agent/src/llm
│   ├── local-git/
│   ├── sanitize/
│   ├── paths.ts
│   └── types.ts
└── data/                  # gitignored
```
