# Linkrowth API

Express gateway between the Chrome extension and the engage agent.

**Status:** Bearer API key auth on `/v1`; health check public. Post persistence and suggestion routes are next.

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
  src/
    index.ts              # listen
    app.ts                # Express app + routes
    config/env.ts         # PORT, NODE_ENV, DATABASE_URL, API_KEY
    middleware/auth.ts    # Bearer API key guard for /v1
```

---

## Endpoints

### Implemented

#### `GET /health`

Liveness check. No auth.

**Response** `200`

```json
{ "ok": true, "service": "linkrowth-api" }
```

#### `GET /v1/ping`

Auth smoke test. Requires Bearer API key.

**Headers**

```http
Authorization: Bearer <API_KEY>
```

**Response** `200`

```json
{ "ok": true }
```

**Errors**

| Status | When |
| --- | --- |
| `401` | Missing/invalid `Authorization` header or wrong key |
| `503` | Server has no `API_KEY` configured |

---

### Planned

These match the schema in `docs/database-schema.md`. Shapes below are drafts; adjust when implementing.

#### `POST /v1/suggestions`

Extension submits a feed post (and optional triage). API upserts `posts`, inserts `suggestion_jobs` (`queued`), triggers engage asynchronously, returns the job id immediately.

**Request body (draft)**

```json
{
  "feedPost": {
    "id": "linkedin-post-id",
    "url": "https://www.linkedin.com/feed/update/…",
    "text": "Post body…",
    "author": {
      "name": "Jane Doe",
      "headline": "Founder @ …",
      "profileUrl": "https://www.linkedin.com/in/jane-doe",
      "username": "jane-doe"
    },
    "metrics": { "likes": 42, "commentsCount": 3 },
    "comments": [],
    "ageText": "2h",
    "extractedAt": "2026-07-16T11:00:00.000Z"
  },
  "triage": {
    "status": "worth_it",
    "score": 0.82,
    "reasons": ["niche match"]
  }
}
```

**Response** `202` (draft)

```json
{
  "jobId": "uuid",
  "postId": "linkedin-post-id",
  "status": "queued"
}
```

#### `GET /v1/suggestions/:jobId`

Poll job status and, when ready, the suggestion run.

**Response** `200` (draft)

```json
{
  "jobId": "uuid",
  "postId": "linkedin-post-id",
  "status": "succeeded",
  "error": null,
  "run": {
    "suggestion": "…",
    "rationale": "…",
    "category": null,
    "agentId": "one_shot_engage"
  }
}
```

`status`: `queued` | `running` | `succeeded` | `failed`.

---

## Auth

Bearer API key on every `/v1/*` route. `/health` stays public (liveness probes).

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
| `DATABASE_URL` | (see `.env.example`) | Required once routes touch Postgres |
| `API_KEY` | (none) | Required for `/v1/*`. Docker Compose defaults to `dev-change-me` via `${API_KEY:-…}` — override in real deploys |

---

## How engage will be invoked

Not wired yet. Intended options (v1 likely the first or second):

1. **In-process** — after commit, background-call `engage()` in the API process.
2. **Worker + queue** — API only enqueues; a worker process calls `engage()` (Postgres poll or Kafka later).
3. **Agent HTTP service** — separate process; API POSTs to it (probably overkill early).

In all cases the HTTP handler returns quickly with `jobId`; the LLM work is async relative to the extension request.

---

## Related packages

| Path | Relationship |
| --- | --- |
| `extension/` | Future client of `POST/GET /v1/suggestions` |
| `agent/` | Provides `engage(post)` for the worker |
| `helpers/schema.sql` | Shared Postgres DDL |
| `docker-compose.yml` | Runs `postgres` + `api` |
