# Distill — Offline Experience Distillation

Offline batch package for Linkrowth. Extracts engineering history, **sanitizes** it into shared candidates, and (later) distills / indexes Experience Artifacts.

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
- Agent later reads only the indexed store — not extractors.

## Current status

| Stage | Status |
|---|---|
| Extract (local + GitHub) | Implemented |
| Sanitize / prune | Implemented |
| Distill (LLM) | Deferred |
| Embed / index | Deferred |

## Setup

```bash
cd distill
cp .env.example .env                          # GITHUB_TOKEN if using GitHub extract
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
```

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
│   ├── github/
│   ├── local-git/
│   ├── sanitize/
│   ├── paths.ts
│   └── types.ts
└── data/                  # gitignored
```
