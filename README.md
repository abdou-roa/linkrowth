# Linkrowth

```text
linkrowth/
  agent/                 # engage CLI + agent — own package.json + .env
  api/                   # Express API gateway — own package.json + .env
  extension/             # LinkedIn feed triage — own package.json + .env
  helpers/               # DB schema + migrate script (applied on Postgres first boot)
  docker-compose.yml     # Postgres + API containers
```

The repo root has **no** `package.json` and **no** `.env`.  
Work inside each package. They do not import each other; connect later via HTTP.

## Agent

**Requirements:** Node.js 18+, Docker, an API key for your chosen provider (OpenAI or Gemini).

```bash
cd agent
cp .env.example .env                           # add your API key (+ DATABASE_URL)
cp config/user.example.json config/user.json   # edit voice notes, samples, substance
npm install

# From repo root: start Postgres, then apply helpers/schema.sql
# docker compose up -d
# ./helpers/migrate.sh

npm run build
npm run engage
```

`engage` persists each post plus a `suggestion_jobs` / `suggestion_runs` row (reasoning steps as JSON) to Postgres. It requires `DATABASE_URL` and a running database — there is no in-memory fallback. If you still have the old agent-only `runs` / `author_role` tables, run `./helpers/migrate.sh --reset` from the repo root.

Paste a post at the prompt, or pipe one in:

```bash
echo "Your post text here…" | npm run engage
```

## API

Express gateway (boilerplate). Runs as its own Docker service.  
Docs: [`api/README.md`](api/README.md).

```bash
# From repo root — Postgres + API
# Schema (helpers/schema.sql) is applied automatically on first Postgres boot.
docker compose up -d --build

# Re-apply schema to an existing volume (idempotent):
./helpers/migrate.sh

# Replace an older/incompatible schema:
./helpers/migrate.sh --reset

curl http://localhost:4000/health
```

Local (without Docker for the API process):

```bash
cd api
cp .env.example .env
npm install
npm run dev          # http://localhost:4000
```

## Extension

```bash
cd extension
cp .env.example .env   # optional until API bridge
npm install
npm run build
# Chrome → chrome://extensions → Load unpacked → extension/dist

npm run dev            # Vite / CRX watch
```
