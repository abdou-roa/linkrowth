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

[![Providers](https://img.shields.io/badge/LLM-OpenAI%20%C2%B7%20Gemini%20%C2%B7%20Claude%20%C2%B7%20Kimi-412991.svg)](#-swappable-llm-providers)
[![Episode](https://img.shields.io/badge/Episode-1%20shipped-brightgreen.svg)](./docs/EPISODE-1.md)
[![Series](https://img.shields.io/badge/%23PromptToArchitecture-000.svg)](./docs/CONTENT-STRATEGY.md)
[![Human-in-the-loop](https://img.shields.io/badge/Human--in--the--loop-ToS%20clean-success.svg)](#-principles-non-goals)

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

One surface-agnostic function. The CLI, the API worker, and the browser extension are all just consumers of it:

```ts
engage(post, context) → { suggestion, rationale }
```

| Param | Type | Description |
|---|---|---|
| `post` | `string` (+ optional author) | The LinkedIn post to engage with |
| `context` | `UserContext` | Your niche, positioning, target audience (+ voice, later) |
| `suggestion` | `string` | A comment that demonstrates expertise and invites a reply |
| `rationale` | `string` | One line: why this comment serves the goal |

**Invariant:** this signature stays stable across every Episode. New layers wrap it; they never change it.

## The Episode ladder

Each Episode adds exactly one layer, and only when the previous one has a *demonstrable* failure.

| Episode | Layer | Villain it fixes | Status |
|---|---|---|---|
| **1** | `engage()` core + paste-in CLI | "Generic — sounds like everyone" | ✅ **shipped** |
| **2** | Voice: your past writing as context | "Right voice, but why this post?" | 🔜 planned |
| **3** | Triage: score whether a post is worth engaging | "Good comment, I still hunt posts manually" | 🔜 planned |
| **4** | Browser extension surfaces the feed | "It forgets who I've already talked to" | 🚧 in progress (feed triage live) |
| **5** | Memory: relationships, history, no repeats | "One-shot drafts are mediocre" | 🔜 planned |
| **6** | Critic loop: draft → tone/authority check → revise | "It's a pile of scripts" | 🔜 planned |
| **7** | Orchestration: daily prioritized engagement queue | Season finale / X port | 🔜 planned |

> Full rationale, decision log, and data model: [`docs/SPEC.md`](./docs/SPEC.md).

## Architecture

```text
                       ┌─────────────────────────────┐
   LinkedIn feed  ───►  │  extension/  (Chrome MV3)    │  observe → extract → score
                       │  triage badges + side panel │  → "worth it?" (heuristic today)
                       └───────────────┬─────────────┘
                                       │ HTTP (planned bridge)
                                       ▼
                       ┌─────────────────────────────┐
                       │  api/  (Express gateway)     │  Bearer auth · enqueue job
                       │  POST/GET /v1/suggestions    │  persist post + run
                       └───────────────┬─────────────┘
                                       │ worker calls
                                       ▼
                       ┌─────────────────────────────┐
                       │  agent/  engage(post, ctx)   │  the stable brain
                       │  provider-agnostic llm.call()│  → { suggestion, rationale }
                       └───────────────┬─────────────┘
                                       ▼
                              Postgres (posts + runs, reasoning as JSON)
```

## Repository layout

```text
linkrowth/
├── agent/        # engage CLI + agent brain — provider-agnostic LLM clients + Postgres runs + evals
├── api/          # Express API gateway — Bearer auth, suggestion job enqueue/poll
├── extension/    # Chrome MV3 LinkedIn feed triage — observe, score, badge, side panel
├── helpers/      # schema.sql + migrate.sh (applied on Postgres first boot)
├── docs/         # SPEC, episode plans, content strategy, schema, integration notes
└── docker-compose.yml   # Postgres + API containers
```

The repo root has **no** `package.json` and **no** `.env`. Each package is independent — they don't import each other and connect over HTTP. Work inside each one.

## Quick start

### 1. Agent (the brain)

**Requires:** Node.js ≥ 18, Docker, and an API key for your chosen provider (OpenAI, Gemini, Anthropic, or Kimi).

```bash
cd agent
cp .env.example .env                           # add your API key (+ DATABASE_URL)
cp config/user.example.json config/user.json   # edit niche, positioning, audience
npm install

npm run db:up                                  # Postgres via root docker-compose.yml
npm run db:migrate                             # create posts + runs tables

npm run build
npm run engage                                 # paste a post, get a suggestion
```

Pipe a post straight in:

```bash
echo "Your post text here…" | npm run engage
```

`engage` persists each post and run (including reasoning steps as JSON) to Postgres. It requires a reachable `DATABASE_URL` — there is no in-memory fallback.

### 2. API (the gateway)

```bash
# From repo root — Postgres + API together.
# helpers/schema.sql is applied automatically on first Postgres boot.
docker compose up -d --build

curl http://localhost:4000/health              # {"ok":true,"service":"linkrowth-api"}
```

Re-apply the schema to an existing volume with `./helpers/migrate.sh` (add `--reset` to replace an incompatible schema). Run the API on the host instead with `cd api && cp .env.example .env && npm install && npm run dev`. Endpoint reference: [`api/ENDPOINTS.md`](./api/ENDPOINTS.md).

### 3. Extension (the feed)

```bash
cd extension
cp .env.example .env       # optional until the API bridge lands
npm install
npm run build              # → extension/dist
npm run dev                # Vite + CRX HMR
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/dist`. Open the LinkedIn feed, click the Linkrowth action to open the side panel, and scroll — fully visible posts get scored and badged. Details: [`extension/README.md`](./extension/README.md), scoring rules in [`extension/SCORING.md`](./extension/SCORING.md).

## Swappable LLM providers

The agent routes every call through a single provider-agnostic `llm.call()`. Switch providers with one env var — no code change:

```bash
LINKROWTH_PROVIDER=openai   # openai (default) · gemini · anthropic · kimi
```

| Provider | Env key | Default model | Status |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | ✅ implemented |
| Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` | ✅ implemented |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` | ⬜ stub |
| Kimi / Moonshot | `KIMI_API_KEY` | `moonshot-v1-8k` | ⬜ stub |

Only the active provider's key is validated at startup (fail-fast). Full matrix: [`docs/SPEC.md`](./docs/SPEC.md) §9.

## Evals

The agent ships with an evaluation harness (`agent/evals/`) — a dataset plus tone, category, and AI-judge scorers — so prompt changes can be measured, not vibed.

```bash
cd agent && npm run eval
```

## Principles & non-goals

- **No scraping, no ToS violations.** Feed access is via a browser extension with the human present — never headless automation.
- **No autonomous posting.** The agent suggests; the human ships. Always human-in-the-loop.
- **No SaaS until it earns it.** CLI first, extension second. No server infra before the architecture demands it.

## Documentation

| Doc | What's inside |
|---|---|
| [`docs/SPEC.md`](./docs/SPEC.md) | Technical & functional spec, episode ladder, decision log |
| [`docs/EPISODE-1.md`](./docs/EPISODE-1.md) | Episode 1 scope, contract, and ship gate |
| [`docs/CONTENT-STRATEGY.md`](./docs/CONTENT-STRATEGY.md) | The build-in-public content engine |
| [`docs/POSTING-PLAYBOOK.md`](./docs/POSTING-PLAYBOOK.md) | Post archetypes and worked examples |
| [`docs/database-schema.md`](./docs/database-schema.md) | Posts + runs schema |
| [`docs/extension-integration.md`](./docs/extension-integration.md) | How the extension, API, and agent connect |

## License

[MIT](./LICENSE) © 2026 Linkrowth

<div align="center">

**#PromptToArchitecture** — start with one prompt, earn every layer.

</div>
