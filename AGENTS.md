# AGENTS.md

## Cursor Cloud specific instructions

Linkrowth is a Node/TypeScript monorepo with three packages plus Postgres. Standard run/build/test commands live in `README.md`, `api/ENDPOINTS.md`, and each package's `package.json` scripts — prefer those. The notes below only cover non-obvious, environment-specific gotchas for this cloud VM.

### Services overview
- `agent/` — the engage "brain" (multi-step `analyze → draft → refine`) + CLI (`npm run engage`). Consumed in-process by the API via the local `file:../agent` dependency.
- `api/` — Express gateway on port `4000` (Bearer auth). `npm run dev` (tsx watch); its `predev`/`prebuild` hooks build `../agent` first, so you rarely need to build the agent by hand.
- `extension/` — Chrome MV3 (Vite). `npm run build` → `extension/dist`, then load unpacked in Chrome.
- PostgreSQL 16 — hard dependency for both the agent CLI and the API (no in-memory fallback).

### Postgres is native here (not Docker) and does NOT auto-start
Docker is not installed in this VM, so Postgres 16 runs as a native cluster instead of via `docker-compose.yml`. The cluster does not come up on VM boot — start it each session before running the API or CLI:
```bash
sudo pg_ctlcluster 16 main start   # check with: pg_lsclusters
```
Connection string (matches the compose defaults the code expects):
```
DATABASE_URL=postgresql://linkrowth:linkrowth@localhost:5432/linkrowth
```
The `linkrowth` role/database and schema are already created (persisted in the VM). Re-apply or reset the schema with the repo helper (works against a `DATABASE_URL`, no Docker needed):
```bash
DATABASE_URL=postgresql://linkrowth:linkrowth@localhost:5432/linkrowth ./helpers/migrate.sh          # idempotent
DATABASE_URL=postgresql://linkrowth:linkrowth@localhost:5432/linkrowth ./helpers/migrate.sh --reset   # wipe + reapply
```

### Local-only files (gitignored — must exist before running)
`agent/.env`, `api/.env`, `extension/.env`, and `agent/config/user.json` are gitignored. They are already populated in this VM. If missing, copy from the `*.env.example` files and `agent/config/user.example.json`. `api/.env` uses `API_KEY=dev-local-key`; the extension's `LINKROWTH_API_KEY` must match it.

### An LLM provider key is required to actually generate comments
The API starts, authenticates, persists posts, and enqueues jobs WITHOUT any LLM key — but the in-process worker calls `getActiveProviderConfig()` lazily, so a queued job flips to `failed` with `Missing OPENAI_API_KEY ...` until a key is set. Set `OPENAI_API_KEY` (default provider, `gpt-4o-mini`) or `GEMINI_API_KEY` (+ `LINKROWTH_PROVIDER=gemini`) in `agent/.env` and `api/.env` to reach `succeeded`. Only the active provider's key is validated. Restart `npm run dev` after editing `.env` (env is read at startup, not hot-reloaded).

### Quick smoke test (no LLM key needed)
```bash
curl -s http://localhost:4000/health                                   # {"ok":true,...,"database":"up"}
curl -s -H "Authorization: Bearer dev-local-key" http://localhost:4000/v1/ping   # {"ok":true}
```
