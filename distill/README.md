# Distill — Offline Worker

Batch package for extract → sanitize → distill → index. Not on the engage hot path.

**Documentation**

| Topic | Doc |
|---|---|
| LLM distillation (artifacts, drop rules, debugging) | [`docs/distillation.md`](../docs/distillation.md) |
| Embeddings, SQLite index, cosine search, query-time retrieval | [`docs/retrieval-layer.md`](../docs/retrieval-layer.md) |
| GitHub extract | [`docs/DISTILL-GITHUB-INGESTION.md`](../docs/DISTILL-GITHUB-INGESTION.md) |
| Local git extract | [`docs/local-git-ingestion-spec.md`](../docs/local-git-ingestion-spec.md) |

## Setup

```bash
cd distill
cp .env.example .env                          # GITHUB_TOKEN + OPENAI_API_KEY or GEMINI_API_KEY
cp config/repos.local.example.json config/repos.local.json
cp config/repos.github.example.json config/repos.github.json
npm install
```

## Commands

```bash
npm run extract:local    # → data/raw-local-git-logs.json
npm run extract:github   # → data/raw-prs.json
npm run sanitize         # → data/candidates.sanitized.json
npm run distill          # → data/artifacts.json
npm run index            # → data/experience-index.db
npm run search -- "postgres suggestion jobs"
npm test
```

Optional env: `DISTILL_LIMIT`, `DISTILL_CONCURRENCY` (default 3), `DISTILL_FORCE=1`, `SEARCH_K` (default 5).
