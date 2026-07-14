# Linkrowth extension — code guide

This document explains how the browser extension is organized and how data flows through it at runtime.

Phase 1 scope: **local feed triage only** (visibility → extract → heuristic score → badges + side panel). No calls to the `agent/` package or any backend yet.

---

## High-level architecture

Manifest V3 extension with three runtime surfaces plus shared library code:

```text
LinkedIn tab
  └─ content script          observe DOM, extract posts, draw badges
           │ chrome.runtime.sendMessage
           ▼
  service worker             queue, dedupe, score, persist session triage
           │ chrome.runtime.sendMessage / reply
           ▼
  side panel                 triage board UI
```

They never import Node/`agent` code. Communication is only via the typed message protocol in `src/shared/messages.ts`.

---

## Directory map

```text
extension/
  manifest.config.ts       Chrome MV3 manifest (via @crxjs/vite-plugin)
  vite.config.ts           Build / HMR
  package.json             Independent package (@linkrowth/extension)
  .env.example             Future API URL (unused in Phase 1)
  public/icons/            Extension icons
  src/
    background/
      service-worker.ts    Queue + scoring + session store orchestration
    content/
      main.ts              Content-script entry
      observer.ts          100% viewport IntersectionObserver
      extract.ts           LinkedIn DOM → FeedPost
      badge.ts             On-card status label
      badge.css            Badge styles injected into the page
    sidepanel/
      index.html           Side panel shell
      main.ts              List / filter / live updates
      styles.css           Panel styles
    shared/
      types.ts             FeedPost, TriageResult, TriageEntry, statuses
      messages.ts          Message union + type guard
      scoring.ts           Heuristic scorer
      store.ts             Session triage persistence
      queue.ts             Concurrency-limited job queue
```

---

## Runtime flow

```text
1. User scrolls LinkedIn feed
2. observer.ts      card reaches intersectionRatio === 1 (fully visible)
3. extract.ts       DOM → FeedPost (id, text, author, metrics, …)
4. main.ts          badge → Queued; send POST_VISIBLE to service worker
5. service-worker   dedupe + JobQueue (max 2); status → Roasting…
6. scoring.ts       heuristic score → worth_it | not_worth_it
7. store.ts         upsert TriageEntry (chrome.storage.session)
8. broadcast        TRIAGE_UPDATED
9a. content main    update on-card badge
9b. sidepanel       refresh / append row in triage list
```

Guardrails encoded in code:

| Rule | Where |
| --- | --- |
| Only fully visible cards | `observer.ts` `threshold: 1` |
| Process a post id once per page session | `content/main.ts` `seen` + SW store/dedupe |
| Max 2 concurrent scores | `JobQueue(2)` in service worker |
| No background crawl | Only cards LinkedIn already painted |
| Failed extract ≠ “not worth it” | `failed` status separate from `not_worth_it` |

---

## Entry points

### Manifest (`manifest.config.ts`)

Declares:

- **Service worker** → `src/background/service-worker.ts`
- **Side panel** → `src/sidepanel/index.html`
- **Content script** on `https://www.linkedin.com/*` → `main.ts` + `badge.css`
- Permissions: `storage`, `sidePanel`
- Host permission: LinkedIn only

Build tool: Vite + `@crxjs/vite-plugin` compiles TS and emits a loadable folder in `extension/dist`.

### Content script (`src/content/`)

Runs inside the LinkedIn page.

| File | Role |
| --- | --- |
| `main.ts` | Wires observer → extract → badge → messaging; listens for `TRIAGE_UPDATED` to refresh badges |
| `observer.ts` | `IntersectionObserver` + `MutationObserver` so new feed cards get watched as LinkedIn injects them |
| `extract.ts` | Fragile LinkedIn selectors → `FeedPost`; sets `data-linkrowth-post-id` on the card for later badge updates |
| `badge.ts` / `badge.css` | Single corner label per card (`Queued`, `Roasting…`, `Worth it`, …) |

**Note:** Selectors in `observer.ts` / `extract.ts` will break when LinkedIn changes markup. Keep extraction isolated here; fix with fixtures later.

### Service worker (`src/background/service-worker.ts`)

Central coordinator:

1. On install: open side panel when the toolbar action is clicked.
2. On message: handle `POST_VISIBLE`, `LIST_TRIAGE`, `RETRY_TRIAGE`.
3. `enqueueTriage`:
   - skip if already stored (unless retry)
   - mark `roasting`, broadcast
   - call `scoreFeedPost`
   - persist + broadcast result (or `failed`)

Concurrency: `JobQueue` runs at most two triage jobs at once; the rest wait.

### Side panel (`src/sidepanel/`)

Chrome side panel UI:

- Loads current list via `LIST_TRIAGE`
- Listens for `TRIAGE_UPDATED` for live updates
- “Hide not worth it” filter (default on)
- Shows snippet, score, likes, comments, reasons

No engage / comment actions yet (Phase 2+).

---

## Shared module details

### `types.ts` — domain shapes

| Type | Meaning |
| --- | --- |
| `FeedPost` | Extracted post (id, text, author, metrics, optional comments) |
| `TriageResult` | Score + status + reasons (or error) |
| `TriageEntry` | `{ post, triage }` — one row in the board |
| `TriageStatus` | `idle` \| `queued` \| `roasting` \| `worth_it` \| `not_worth_it` \| `failed` |

### `messages.ts` — IPC protocol

| Type | Direction | Purpose |
| --- | --- | --- |
| `post_visible` | content → SW | New fully visible post to triage |
| `triage_updated` | SW → content + panel | Status/score changed |
| `list_triage` | panel → SW | Request full session list |
| `list_triage_result` | SW → panel | Reply with entries |
| `retry_triage` | panel → SW | Re-run a failed/skipped post (hook ready) |
| `open_side_panel` | reserved | Prefer action-click behavior today |

`isExtensionMessage()` is a shallow runtime guard before handling.

### `scoring.ts` — heuristic (Phase 1)

Local, sync, no LLM. Points from:

- text length (thin / moderate / substantive)
- likes thresholds
- comments-count thresholds

Default pass threshold: `worthItMin = 50` → `worth_it`, else `not_worth_it`.  
Tune here (or later via options) without touching the agent.

### `store.ts` — session persistence

`TriageStore` keeps entries in `chrome.storage.session` (falls back to in-memory if unavailable).  
Sorted with **Worth it** first, then by score descending.

Clears when the browser session ends (by design for Phase 1).

### `queue.ts` — concurrency

Simple promise queue: `enqueue(job)`, at most `concurrency` jobs active (default 2). Used so fast scrolling does not stampede scoring.

---

## Build & load

```bash
cd extension
cp .env.example .env    # optional in Phase 1
npm install
npm run build           # → extension/dist
npm run dev             # Vite + CRX HMR
```

Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist`.

Open LinkedIn feed, click the Linkrowth action to open the side panel, scroll until posts are fully visible.

---

## What this package deliberately does not do

- Import or call `../agent` (separate package)
- Call LinkedIn unofficial APIs or headless browsers
- Auto-like / auto-comment / crawl off-screen posts
- Persist triage across browser restarts (session only)
- LLM second-pass or comment generation (later: API → agent workflow)

---

## Where to change what

| Goal | Start here |
| --- | --- |
| LinkedIn DOM broke | `content/extract.ts`, `content/observer.ts` |
| Badge look / labels | `content/badge.ts`, `content/badge.css` |
| Scoring formula / threshold | `shared/scoring.ts` |
| Queue concurrency | `JobQueue(2)` in `service-worker.ts` |
| Side panel layout | `sidepanel/index.html`, `styles.css`, `main.ts` |
| New message types | `shared/messages.ts` + handlers in SW / content / panel |
| Wire API (Phase 2) | New client module; call from SW or panel — do not put LLM code in the extension |

For product / system integration context (agent, API, phasing), see `docs/extension-integration.md` (local docs).
