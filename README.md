<div align="center">

# Linkrowth

**An AI agent that grows your LinkedIn authority — by leaving comments worth being seen for.**

*Built in public, one layer at a time. Start with one prompt. Add the next layer only when the current one visibly fails.*

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Postgres](https://img.shields.io/badge/Postgres-16-4169E1.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4.svg?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

[![Providers](https://img.shields.io/badge/LLM-OpenAI%20%C2%B7%20Gemini-412991.svg)](#-swappable-llm-providers)
[![Pipeline](https://img.shields.io/badge/Pipeline-analyze%20%E2%86%92%20draft%20%E2%86%92%20refine-brightgreen.svg)](#-multi-step-engage-pipeline)
[![Series](https://img.shields.io/badge/%23PromptToArchitecture-000.svg)](./docs/CONTENT-STRATEGY.md)
[![Human-in-the-loop](https://img.shields.io/badge/Human--in--the--loop-ToS%20clean-success.svg)](#-principles--non-goals)

</div>

---

## Why Linkrowth exists

Growing on LinkedIn as a technical person is a **being-seen problem, not a posting problem**. The highest-leverage move is thoughtful engagement on the *right* posts — but doing it consistently, on posts that matter, in a way that signals real expertise, is exactly the part that decays.

Generic AI comment generators produce `"Great insights! 🔥"` — invisible at best, embarrassing at worst.

Linkrowth is the opposite bet: an agent that reads a post, decides whether it's even worth your time, and drafts a comment that a skimming recruiter or client would *stop* on — in your voice, never salesy, always human-shipped.

## The thesis: earn your complexity

> Start with one prompt and one API call. Add the next layer **only when the current one visibly fails.** No framework, no vector DB, no orchestration until the architecture demands it.

This repo is built as a public series — **From One Prompt to a Fully Architected Agent System**. Every layer is an *Episode*, and every Episode has a villain: the concrete failure that justifies the next layer. The product you're building is an engagement-growth agent, and shipping it in public *is* the engagement-growth play. It dogfoods itself.

## The core abstraction

One surface-agnostic function. The CLI, the API worker, and the browser extension are all consumers of it:

```ts
engage(post, context) → { suggestion, rationale }
```

| Param | Type | Description |
|---|---|---|
| `post` | `string` (+ optional author) | The LinkedIn post to engage with |
| `context` | `UserContext` | Your niche, positioning, voice, substance, and guardrails |
| `suggestion` | `string` | A comment that demonstrates expertise and invites a reply |
| `rationale` | `string` | One line: why this comment serves the goal |

**Invariant:** this signature stays stable across every Episode. New layers wrap it; they never change it.

The runtime path is a **multi-step agent** (`analyze → draft → refine`) that still returns the same `{ suggestion, rationale }` shape.

## The Episode ladder

Each Episode adds exactly one layer, and only when the previous one has a *demonstrable* failure. Work has advanced out of strict ladder order where the architecture demanded it — statuses below reflect what is actually in the repo.

| Episode | Layer | Villain it fixes | Status |
|---|---|---|---|
| **1** | `engage()` core + paste-in CLI | "Generic — sounds like everyone" | ✅ **shipped** |
| **2** | Voice: past writing + persona as context | "Right voice, but why this post?" | ✅ **shipped** |
| **3** | Triage: score whether a post is worth engaging | "Good comment, I still hunt posts manually" | ✅ **shipped** (heuristic, in-extension) |
| **4** | Browser extension surfaces the feed | "It forgets who I've already talked to" | ✅ **shipped** (feed → triage → Generate via API) |
| **5** | Memory: relationships, history, no repeats | "One-shot drafts are mediocre" | 🔜 planned |
| **6** | Critic loop: analyze → draft → refine | "It's a pile of scripts" | ✅ **shipped** (reject → redraft loop, up to 2 attempts) |
| **7** | Orchestration: daily prioritized engagement queue | Season finale / X port | 🔜 planned |

> Full rationale, decision log, and data model: [`docs/SPEC.md`](./docs/SPEC.md). Multi-step design: [`docs/MULTI-STEP-AGENT.md`](./docs/MULTI-STEP-AGENT.md).

## Architecture

```text
   LinkedIn feed  ───►  extension/  (Chrome MV3)
                        observe → extract → heuristic triage
                        badges + side panel + Generate CTA
                                       │
                                       │ HTTP  POST/GET /v1/suggestions
                                       ▼
                        api/  (Express gateway)
                        Bearer auth · enqueue job · in-process worker
                                       │
                                       │ @linkrowth/agent/runs
                                       ▼
                        agent/  multi_step_engage (default)
                        analyze → draft → refine  (reject → redraft, max 2)
                                       │
                                       ▼
                              Postgres (posts + suggestion_jobs + suggestion_runs)
```

## Multi-step engage pipeline

```text
post + UserContext
        │
        ▼
   analyzer   → category, tone, author profile, pivot strategy, length/depth
        │
        ▼
   drafter    → comment draft + rationale (category playbook + voice)
        │
        ▼
   refiner    → critique against fabrication / voice / length guardrails
                (reject → redraft with feedbackHistory; max 2 attempts)
        │
        ▼
   { suggestion, rationale }  (+ reasoning steps persisted as JSON)
```

## Repository layout

```text
linkrowth/
├── agent/        # engage brain — multi-step pipeline, LLM clients, run orchestration, evals
├── api/          # Express gateway — Bearer auth, suggestion jobs; depends on agent + db
├── db/           # @linkrowth/db — Postgres pool, queries, migrations, and seeds
├── extension/    # Chrome MV3 — feed triage, side panel, Generate comment → API
├── distill/      # offline experience distillation + vector index (separate worker later)
├── helpers/      # backward-compatible migrate.sh entrypoint
├── docs/         # SPEC, multi-step design, schema, integration notes, content strategy
└── docker-compose.yml   # Postgres + API containers
```

Offline distillation and retrieval are documented in [`docs/distillation.md`](./docs/distillation.md) and [`docs/retrieval-layer.md`](./docs/retrieval-layer.md). The [`distill/`](./distill/README.md) package runs off the engage hot path.

## Quick start

### 1. Agent (the brain)

**Requirements:** Node.js 18+, Docker, an API key for your chosen provider (OpenAI or Gemini).

```bash
cd agent
cp .env.example .env                           # add your API key (+ DATABASE_URL)
cp config/user.example.json config/user.json   # edit voice notes, samples, substance
npm install

# From repo root: start Postgres, then apply db/migrations in order
# docker compose up -d
# ./helpers/migrate.sh

npm run build
npm run engage                                 # paste a post, get a suggestion
```

`engage` persists each post plus a `suggestion_jobs` / `suggestion_runs` row (reasoning steps as JSON) to Postgres. It requires `DATABASE_URL` and a running database — there is no in-memory fallback. If you still have the old agent-only `runs` / `author_role` tables, run `./helpers/migrate.sh --reset` from the repo root.

Paste a post at the prompt, or pipe one in:

```bash
echo "Your post text here…" | npm run engage
```

### 2. API (the gateway)

```bash
# From repo root — Postgres + API together.
# db/migrations/*.sql are applied automatically on first Postgres boot.
docker compose up -d --build

curl http://localhost:4000/health              # {"ok":true,"service":"linkrowth-api",…}
```

Re-apply the schema to an existing volume with `./helpers/migrate.sh` (add `--reset` to replace an incompatible schema). Run the API on the host instead with `cd api && cp .env.example .env && npm install && npm run dev`. Endpoint reference: [`api/ENDPOINTS.md`](./api/ENDPOINTS.md).

### 3. Extension (the feed)

Needs the API running for **Generate comment**. Local triage (score / badges / side panel) works without it.

```bash
# From repo root first: docker compose up -d --build

cd extension
cp .env.example .env       # LINKROWTH_API_URL + LINKROWTH_API_KEY (match api/.env API_KEY)
npm install
npm run build              # → extension/dist
npm run dev                # Vite + CRX HMR
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/dist`. Open the LinkedIn feed, click the Linkrowth action to open the side panel, and scroll — fully visible posts get scored and badged. Open a comment box (or click a post in the panel) to use **Generate comment**, which calls the API and fills the draft. Details: [`extension/README.md`](./extension/README.md), scoring rules in [`extension/SCORING.md`](./extension/SCORING.md).

## Swappable LLM providers

The agent routes every call through a single provider-agnostic `llm.call()`. Switch providers with one env var — no code change:

```bash
LINKROWTH_PROVIDER=openai   # openai (default) · gemini
```

| Provider | Env key | Default model | Status |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | ✅ implemented |
| Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` | ✅ implemented |

Only the active provider's key is validated at startup (fail-fast). Anthropic / Kimi are deferred until a real provider gap appears.

**Model tiering:** analyzer and refiner use the default model; the drafter can use a stronger one without changing providers:

```bash
LINKROWTH_OPENAI_DRAFT_MODEL=gpt-5.4      # or LINKROWTH_GEMINI_DRAFT_MODEL=gemini-2.5-pro
```

## Evals

The agent ships with an evaluation harness (`agent/evals/`) — a dataset plus category, tone, and AI-judge scorers — so prompt changes can be measured, not vibed. Today it runs the one-shot `core/engage()` path; multi-step evals are a follow-up.

```bash
cd agent && npm run eval
```

## Principles & non-goals

- **No scraping, no ToS violations.** Feed access is via a browser extension with the human present — never headless automation.
- **No autonomous posting.** The agent suggests; the human ships. Always human-in-the-loop.
- **Earn the infra.** CLI first, then extension + API when feed triage and suggestion jobs needed them. The API runs an in-process worker today — no Kafka until a visible failure demands it.

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/distillation.md`](./docs/distillation.md) | Offline LLM distillation — candidates → Experience Artifacts |
| [`docs/retrieval-layer.md`](./docs/retrieval-layer.md) | Embeddings, SQLite index, cosine similarity, query-time retrieval |
| [`docs/retrieval-params.md`](./docs/retrieval-params.md) | Retrieval env vars, overrides, filters, and example configs |
| [`docs/SPEC.md`](./docs/SPEC.md) | Technical & functional spec, episode ladder, decision log |
| [`docs/MULTI-STEP-AGENT.md`](./docs/MULTI-STEP-AGENT.md) | Agents / steps design (analyzer → drafter → refiner) |
| [`docs/structure.md`](./docs/structure.md) | Agent package layering and module rules |
| [`docs/EPISODE-1.md`](./docs/EPISODE-1.md) | Episode 1 scope, contract, and ship gate |
| [`docs/CONTENT-STRATEGY.md`](./docs/CONTENT-STRATEGY.md) | The build-in-public content engine |
| [`docs/POSTING-PLAYBOOK.md`](./docs/POSTING-PLAYBOOK.md) | Post archetypes and worked examples |
| [`docs/database-schema.md`](./docs/database-schema.md) | Posts + jobs + runs schema |
| [`docs/extension-integration.md`](./docs/extension-integration.md) | How the extension, API, and agent connect |
| [`api/ENDPOINTS.md`](./api/ENDPOINTS.md) | HTTP API reference |
| [`extension/README.md`](./extension/README.md) | Extension runtime guide |

## License

[MIT](./LICENSE) © 2026 Linkrowth

<div align="center">

**#PromptToArchitecture** — start with one prompt, earn every layer.

</div>
