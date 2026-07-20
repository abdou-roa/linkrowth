# Linkrowth API

Express gateway between the Chrome extension and the engage agent.

**Status:** Postgres + Bearer auth + suggestion enqueue/poll endpoints. Engage runs **in-process** after enqueue (direct `@linkrowth/agent` import).

Base URL (Docker / local default): `http://localhost:4000`

---

## Role

```text
Extension (user clicks a post)
  → API upserts post + creates suggestion job
  → Worker/background runs engage(post)
  → Result stored; extension polls (or SSE later)
```

| Concern | Owner |
| --- | --- |
| HTTP surface, auth, validation | `api/` |
| Schema + migrations | API / `helpers/schema.sql` |
| Comment suggestion LLM | `agent/` (`engage`) — called by worker, not by the extension |
| Feed triage UI | `extension/` |

The API does **not** import the extension. The agent should stay pure compute once wired; the API/worker owns Postgres writes for jobs and runs.

Schema draft: see `docs/database-schema.md` (local) and `helpers/schema.sql`.

---

## Run

### Docker (recommended)

From the repo root:

```bash
docker compose up -d --build

curl http://localhost:4000/health
# {"ok":true,"service":"linkrowth-api"}
```

The `api` service depends on healthy Postgres and uses:

```text
DATABASE_URL=postgresql://linkrowth:linkrowth@postgres:5432/linkrowth
PORT=4000
```

Secrets (`API_KEY`, `OPENAI_API_KEY`, …) come from `api/.env` and optionally `agent/.env` via Compose `env_file` — the same files local `npm run dev` uses. Copy from the `.env.example` files if needed.
### Local process (API on the host)

```bash
cd api
cp .env.example .env
npm install
npm run dev          # http://localhost:4000
```

Requires Postgres reachable at `DATABASE_URL` (e.g. `docker compose up -d postgres`).

| Script | What it does |
| --- | --- |
| `npm run dev` | `tsx watch` — reload on change |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled `dist/index.js` |

---

## Layout

```text
api/
  Dockerfile
  package.json
  .env.example
  README.md
  ENDPOINTS.md                  # HTTP API reference
  src/
    index.ts                    # listen + graceful shutdown
    app.ts                      # Express app + routes
    config/env.ts               # PORT, NODE_ENV, DATABASE_URL, API_KEY
    db/client.ts                # pg Pool
    db/suggestions.ts           # upsert post + enqueue/get jobs
    middleware/auth.ts          # Bearer API key guard for /v1
    routes/suggestions/         # POST/GET /v1/suggestions
    types/suggestions.ts        # request/response types
```

---

## Endpoints

Full request/response reference: **[`ENDPOINTS.md`](./ENDPOINTS.md)**.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Readiness (Postgres ping) |
| `GET` | `/v1/ping` | Yes | Auth smoke test |
| `POST` | `/v1/suggestions` | Yes | Enqueue suggestion job for a feed post |
| `GET` | `/v1/suggestions/:jobId` | Yes | Poll job status (+ run when ready) |

Engage runs in-process after enqueue — poll until `status` is `succeeded` or `failed`.

---

## Auth

Bearer API key on every `/v1/*` route. `/health` stays public (readiness / DB check).

```http
Authorization: Bearer <API_KEY>
```

Set the same secret on both sides:

| Side | Variable |
| --- | --- |
| API | `API_KEY` |
| Extension (later) | `LINKROWTH_API_KEY` |

Generate a strong key:

```bash
openssl rand -hex 32
```

Implementation: `src/middleware/auth.ts` — constant-time compare via `crypto.timingSafeEqual`. No third-party auth library: for a single shared secret this is the usual Express pattern; Passport / OAuth stacks are for user sessions, not extension → API keys.

Verify locally:

```bash
# Fail without key
curl -i http://localhost:4000/v1/ping

# Succeed with key
curl -i -H "Authorization: Bearer dev-change-me" http://localhost:4000/v1/ping
```

---

## Env

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | Host/container listen port (avoids clash with extension tooling on `3000`) |
| `NODE_ENV` | `development` | `production` in Docker |
| `DATABASE_URL` | (required) | Postgres connection string. Validated at process start |
| `API_KEY` | (none) | Required for `/v1/*`. Loaded from `api/.env` when using Docker Compose |

---

## How engage is invoked

**In-process (current):** after a job is enqueued, the API background-calls `runEngage()` from `@linkrowth/agent`. The HTTP handler still returns immediately with `jobId`; the extension polls for the result.

Requires the same LLM env vars as `agent/` (see `api/.env.example`) and `agent/config/user.json` (copy from `agent/config/user.example.json`).

Future options: separate worker process, or agent HTTP service.

---

## Related packages

| Path | Relationship |
| --- | --- |
| `extension/` | Future client of `POST/GET /v1/suggestions` |
| `agent/` | Provides `engage(post)` for the worker |
| `helpers/schema.sql` | Shared Postgres DDL |
| `docker-compose.yml` | Runs `postgres` + `api` |
