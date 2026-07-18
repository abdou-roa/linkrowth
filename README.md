# Linkrowth

> A personal LinkedIn growth toolchain built in public, one episode at a time.

---

## The problem

Growing on LinkedIn as a technical person is a *being-seen* problem, not a posting problem.

The highest-leverage move is consistent, thoughtful engagement on the right posts. A comment that demonstrates genuine expertise on a post that already has traction can surface you to hundreds of relevant people overnight. But doing that consistently — finding the right posts, writing something worth reading, not repeating yourself, not sounding like everyone else — is exactly the part that erodes first.

Generic AI comment generators make it worse, not better. "Great insights! Really resonates." is invisible at best, and signals the opposite of expertise. It trains people to skip your name.

The real gap is not automation. It is *judgment* — knowing which post is worth your time, and saying something specific enough to be worth saying.

---

## The solution

Linkrowth is a small, compounding toolchain that adds exactly one layer of judgment at a time.

It starts with a CLI that takes a LinkedIn post and produces a comment designed to demonstrate authority and invite a reply — not one that sounds like everyone else's output. Each episode adds one more layer on top of that stable core: your writing voice, a feed scanner that filters noise, a browser extension that scores posts as you scroll, memory of who you have already talked to, and eventually a full daily engagement queue.

The architecture has one rule: a new layer is only added when the previous one has a visible, demonstrable failure. No feature earns its place before that.

**Core abstraction — stable across all episodes:**

```
engage(post, context) → { suggestion, rationale }
```

Every surface (CLI, extension, future app) is a consumer of this function. Nothing is added inside it until the outside fails.

---

## Episode ladder

| Episode | Layer | Failure it fixes | Status |
|---|---|---|---|
| 1 | `engage()` core + paste-in CLI | "Generic — sounds like everyone" | `shipped` |
| 2 | Voice: past writing as context | "Right voice, but why this post?" | `planned` |
| 3 | Triage: score whether a post is worth engaging | "Good comment, I still hunt posts manually" | `planned` |
| 4 | Browser extension surfaces the feed | "It forgets who I have already talked to" | `shipped` (Phase 1) |
| 5 | Memory: relationships, history, no repeats | "One-shot drafts are mediocre" | `planned` |
| 6 | Critic loop: draft, tone/authority check, revise | "It's a pile of scripts" | `planned` |
| 7 | Orchestration: daily prioritized engagement queue | Season finale | `planned` |

---

## What is shipped today

**Episode 1 — CLI agent**

Paste a LinkedIn post, get one comment suggestion and a one-line rationale. Backed by OpenAI, Gemini, Anthropic, or Kimi — switchable via a single env variable. Every run and its reasoning is persisted to Postgres for later analysis.

**Episode 4 — Browser extension (Phase 1)**

A Chrome extension that watches your LinkedIn feed as you scroll. Every fully visible post is scored in real time with a heuristic (age, likes, comment velocity) and tagged with a badge directly on the card. A side panel shows the ranked triage board for the session so you can spot the worth-engaging posts at a glance — without leaving LinkedIn.

No LLM call, no background crawl, no auto-liking. It reads what LinkedIn already painted on screen and nothing else.

---

## Running locally

The repo is organized as three independent packages. They share a Postgres database and connect over HTTP; they do not import each other.

```
linkrowth/
  agent/          CLI engage tool — own package.json + .env
  api/            Express API gateway — own package.json + .env
  extension/      Chrome extension — own package.json + .env
  helpers/        DB schema + migrate script
  docker-compose.yml
```

**Prerequisites:** Node.js 18+, Docker, an API key for at least one LLM provider.

---

### 1. Start the database (and API)

```bash
# From repo root — spins up Postgres (+ API container)
docker compose up -d --build

# Verify
curl http://localhost:4000/health
```

The schema in `helpers/schema.sql` is applied automatically on first boot. To re-apply to an existing volume:

```bash
./helpers/migrate.sh          # idempotent
./helpers/migrate.sh --reset  # drop and recreate
```

---

### 2. Agent (CLI)

```bash
cd agent
cp .env.example .env                           # fill in your API key + DATABASE_URL
cp config/user.example.json config/user.json   # set your niche, positioning, audience

npm install
npm run db:migrate   # create posts + runs tables
npm run build

npm run engage       # interactive — paste a post at the prompt
```

Pipe a post directly:

```bash
echo "Your LinkedIn post text here…" | npm run engage
```

Switch LLM provider in `.env`:

```bash
LINKROWTH_PROVIDER=gemini     # openai | gemini | anthropic | kimi
GEMINI_API_KEY=your-key-here
```

---

### 3. Extension

```bash
cd extension
cp .env.example .env   # optional until the API bridge is wired
npm install
npm run build          # compiles to extension/dist

# Dev mode with hot reload:
npm run dev
```

Load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `extension/dist`
4. Open LinkedIn, click the Linkrowth icon to open the side panel, scroll the feed

---

### 4. API (optional — runs in Docker by default)

To run the API process locally outside Docker:

```bash
cd api
cp .env.example .env
npm install
npm run dev   # http://localhost:4000
```

---

## Deployment

Linkrowth is currently a local-first personal tool. If this project attracts enough interest from the community, a hosted version may be deployed — so you can run it without any setup. Star the repo and share it if you want that to happen.

---

## I use this daily

Every episode that ships goes into my own workflow the same day. I use the CLI to draft comments before posting them, and I have the extension running every time I open LinkedIn. Nothing is in here that I do not personally find useful — and nothing ships until the previous version visibly fails in practice.

This is built in public. The episode spec, changelog, and architecture decisions are all tracked in `docs/`.

---

## License

[MIT](./LICENSE)
