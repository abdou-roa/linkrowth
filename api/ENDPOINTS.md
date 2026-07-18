# Linkrowth API — Endpoints

Base URL (Docker / local default): `http://localhost:4000`

All `/v1/*` routes require Bearer auth. `GET /health` is public.

```http
Authorization: Bearer <API_KEY>
```

`API_KEY` is set on the API process; the extension will send the same value as `LINKROWTH_API_KEY`.

| Error body shape | Used by |
| --- | --- |
| `{ "error": "unauthorized", "message": "…" }` | `401` |
| `{ "error": "auth_not_configured", "message": "…" }` | `503` (no `API_KEY` on server) |
| `{ "error": "validation_error", "message": "…" }` | `400` |
| `{ "error": "not_found", "message": "…" }` | `404` |
| `{ "error": "internal_error", "message": "…" }` | `500` |

---

## Table of contents

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | [`/health`](#get-health) | No | Readiness (Postgres ping) |
| `GET` | [`/v1/ping`](#get-v1ping) | Yes | Auth smoke test |
| `POST` | [`/v1/suggestions`](#post-v1suggestions) | Yes | Enqueue comment suggestion for a feed post |
| `POST` | [`/v1/suggestions/batch`](#post-v1suggestionsbatch) | Yes | Enqueue suggestions for many selected feed posts |
| `GET` | [`/v1/suggestions/:jobId`](#get-v1suggestionsjobid) | Yes | Poll suggestion job (+ run when ready) |

---

## `GET /health`

Readiness check. Runs `SELECT 1` against Postgres. No auth.

### Response `200`

```json
{
  "ok": true,
  "service": "linkrowth-api",
  "database": "up"
}
```

### Response `503`

Postgres unreachable.

```json
{
  "ok": false,
  "service": "linkrowth-api",
  "database": "down"
}
```

### Example

```bash
curl -s http://localhost:4000/health
```

---

## `GET /v1/ping`

Auth smoke test. Confirms the Bearer key works before calling suggestion routes.

### Headers

```http
Authorization: Bearer <API_KEY>
```

### Response `200`

```json
{ "ok": true }
```

### Errors

| Status | `error` | When |
| --- | --- | --- |
| `401` | `unauthorized` | Missing header, non-Bearer scheme, or wrong key |
| `503` | `auth_not_configured` | Server has no `API_KEY` |

### Example

```bash
curl -s -H "Authorization: Bearer $API_KEY" http://localhost:4000/v1/ping
```

---

## `POST /v1/suggestions`

Extension submits a LinkedIn feed post (and optional local triage). The API:

1. Upserts the row in `posts`
2. Inserts a `suggestion_jobs` row with `status: "queued"`
3. Returns the job id immediately (`202`)

Engage / LLM work is **not** started yet — jobs stay `queued` until a worker is wired.

**Idempotency:** if an active job (`queued` or `running`) already exists for the same `feedPost.id`, that job is returned instead of creating a duplicate.

### Headers

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

### Request body

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
    "metrics": {
      "likes": 42,
      "commentsCount": 3
    },
    "comments": [
      {
        "author": "Alex",
        "text": "Good point.",
        "likes": 2
      }
    ],
    "ageText": "2h",
    "extractedAt": "2026-07-16T11:00:00.000Z"
  },
  "triage": {
    "status": "worth_it",
    "score": 0.82,
    "reasons": ["niche match"],
    "error": null,
    "scoredAt": "2026-07-16T11:00:01.000Z"
  },
  "notes": "Mention their launch week and ask what broke first"
}
```

### `feedPost` fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | LinkedIn post id (primary key in `posts`) |
| `text` | string | yes | Post body |
| `extractedAt` | string | yes | ISO-8601 timestamp from the extension |
| `url` | string | no | Canonical post URL |
| `author.name` | string | no | |
| `author.headline` | string | no | |
| `author.profileUrl` | string | no | e.g. `https://www.linkedin.com/in/…` |
| `author.username` | string | no | Vanity slug from `/in/{username}` |
| `metrics.likes` | number | no | |
| `metrics.commentsCount` | number | no | |
| `comments` | array | no | Each item needs `text`; `author` / `likes` optional |
| `ageText` | string | no | Raw LinkedIn age label (`15m`, `2h`, `1d`) |

### `notes` (optional)

User angle / ideas for the comment. Empty or omitted = quick suggestion (no guidance).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `notes` | string | no | Stored on `suggestion_jobs.notes` |

### `triage` fields (optional)

Stored as JSONB on `suggestion_jobs.triage`. Shape matches the extension’s local triage result (without requiring `feedPostId`).

| Field | Type | Notes |
| --- | --- | --- |
| `status` | string | e.g. `worth_it`, `not_worth_it` |
| `score` | number | Heuristic score from the extension |
| `reasons` | string[] | Human-readable reasons |
| `error` | string | Present when triage failed |
| `scoredAt` | string | ISO-8601 |

### Response `202`

```json
{
  "jobId": "3e953bfb-fc6c-4b25-a825-e44eb7d7fe56",
  "postId": "linkedin-post-id",
  "status": "queued"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `jobId` | UUID string | Poll with `GET /v1/suggestions/:jobId` |
| `postId` | string | Same as `feedPost.id` |
| `status` | string | Usually `queued`; may be `running` if returning an existing active job |

### Errors

| Status | `error` | When |
| --- | --- | --- |
| `400` | `validation_error` | Missing/invalid body fields |
| `401` | `unauthorized` | Bad or missing API key |
| `500` | `internal_error` | Unexpected failure |
| `503` | `auth_not_configured` | Server has no `API_KEY` |

### Example

```bash
curl -s -X POST http://localhost:4000/v1/suggestions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "feedPost": {
      "id": "linkedin-post-id",
      "text": "Shipping APIs is underrated.",
      "extractedAt": "2026-07-16T11:00:00.000Z",
      "metrics": { "likes": 42, "commentsCount": 3 },
      "ageText": "2h"
    },
    "triage": {
      "status": "worth_it",
      "score": 0.82,
      "reasons": ["niche match"]
    }
  }'
```

---

## `POST /v1/suggestions/batch`

Enqueue suggestion jobs for many selected feed posts in one request (mass select from the side panel).

For each item the API:

1. Upserts the row in `posts`
2. Inserts a `suggestion_jobs` row with `status: "queued"` (or returns an existing active job)

All items run in a **single DB transaction**. Validation is all-or-nothing: any invalid item rejects the whole request with `400`.

**Idempotency:** same as single create — if an active job (`queued` or `running`) already exists for a post, that job is returned in `results` instead of creating a duplicate.

**Limits:** `items` must be non-empty and at most **50** entries.

### Headers

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

### Request body

```json
{
  "items": [
    {
      "feedPost": {
        "id": "linkedin-post-id-1",
        "text": "Shipping APIs is underrated.",
        "extractedAt": "2026-07-16T11:00:00.000Z"
      },
      "triage": {
        "status": "worth_it",
        "score": 0.82,
        "reasons": ["niche match"]
      },
      "notes": "Ask what broke first"
    },
    {
      "feedPost": {
        "id": "linkedin-post-id-2",
        "text": "Another post…",
        "extractedAt": "2026-07-16T11:01:00.000Z"
      },
      "triage": {
        "status": "worth_it",
        "score": 0.71
      }
    }
  ]
}
```

Each entry in `items` uses the same shape as [`POST /v1/suggestions`](#post-v1suggestions) (`feedPost`, optional `triage`, optional `notes`).

### Response `202`

`results` are in the **same order** as `items`.

```json
{
  "results": [
    {
      "jobId": "3e953bfb-fc6c-4b25-a825-e44eb7d7fe56",
      "postId": "linkedin-post-id-1",
      "status": "queued"
    },
    {
      "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "postId": "linkedin-post-id-2",
      "status": "queued"
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `results[].jobId` | UUID string | Poll with `GET /v1/suggestions/:jobId` |
| `results[].postId` | string | Same as that item’s `feedPost.id` |
| `results[].status` | string | Usually `queued`; may be `running` if returning an existing active job |

### Errors

| Status | `error` | When |
| --- | --- | --- |
| `400` | `validation_error` | Empty/oversized `items`, or invalid entry (message prefixed with `items[i]:`) |
| `401` | `unauthorized` | Bad or missing API key |
| `500` | `internal_error` | Unexpected failure |
| `503` | `auth_not_configured` | Server has no `API_KEY` |

### Example

```bash
curl -s -X POST http://localhost:4000/v1/suggestions/batch \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "feedPost": {
          "id": "linkedin-post-id-1",
          "text": "Shipping APIs is underrated.",
          "extractedAt": "2026-07-16T11:00:00.000Z"
        }
      },
      {
        "feedPost": {
          "id": "linkedin-post-id-2",
          "text": "Another post…",
          "extractedAt": "2026-07-16T11:01:00.000Z"
        }
      }
    ]
  }'
```

---

## `GET /v1/suggestions/:jobId`

Poll a suggestion job. When a worker has finished, `run` includes the latest `suggestion_runs` row for that job; until then `run` is `null`.

### Headers

```http
Authorization: Bearer <API_KEY>
```

### Path params

| Param | Type | Notes |
| --- | --- | --- |
| `jobId` | UUID | From `POST /v1/suggestions` |

### Response `200` (still queued / no run yet)

```json
{
  "jobId": "3e953bfb-fc6c-4b25-a825-e44eb7d7fe56",
  "postId": "linkedin-post-id",
  "status": "queued",
  "error": null,
  "run": null
}
```

### Response `200` (succeeded, after worker)

```json
{
  "jobId": "3e953bfb-fc6c-4b25-a825-e44eb7d7fe56",
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

### Response fields

| Field | Type | Notes |
| --- | --- | --- |
| `jobId` | UUID string | |
| `postId` | string | |
| `status` | `"queued"` \| `"running"` \| `"succeeded"` \| `"failed"` | |
| `error` | string \| null | Set when `status` is `failed` |
| `run` | object \| null | Latest run for the job, or `null` |
| `run.suggestion` | string \| null | Generated comment |
| `run.rationale` | string \| null | |
| `run.category` | string \| null | |
| `run.agentId` | string \| null | e.g. engage agent id |

### Errors

| Status | `error` | When |
| --- | --- | --- |
| `400` | `validation_error` | `jobId` is not a UUID |
| `401` | `unauthorized` | Bad or missing API key |
| `404` | `not_found` | Unknown job |
| `500` | `internal_error` | Unexpected failure |
| `503` | `auth_not_configured` | Server has no `API_KEY` |

### Example

```bash
JOB_ID=3e953bfb-fc6c-4b25-a825-e44eb7d7fe56
curl -s -H "Authorization: Bearer $API_KEY" \
  "http://localhost:4000/v1/suggestions/$JOB_ID"
```

---

## Extension flow (intended)

```text
1. Extension triages a post locally (worth_it)
2. POST /v1/suggestions  { feedPost, triage }  →  { jobId, status: "queued" }
3. Poll GET /v1/suggestions/:jobId until status is succeeded | failed
4. On succeeded, show run.suggestion in the UI
```

Today steps 2–3 work end-to-end against Postgres; step 3 will keep returning `queued` / `run: null` until the engage worker is connected.

---

## Related

| Doc / path | What |
| --- | --- |
| [`README.md`](./README.md) | Run, layout, env, auth overview |
| [`../helpers/schema.sql`](../helpers/schema.sql) | `posts`, `suggestion_jobs`, `suggestion_runs` |
| `extension/src/shared/types.ts` | `FeedPost` / `TriageResult` shapes the request mirrors |
