# Linkrowth

```text
linkrowth/
  agent/                 # engage CLI + agent — own package.json + .env
  extension/             # LinkedIn feed triage — own package.json + .env
  docker-compose.yml     # shared infra only (Postgres)
```

The repo root has **no** `package.json` and **no** `.env`.  
Work inside each package. They do not import each other; connect later via HTTP.

## Agent

```bash
cd agent
cp .env.example .env
cp config/user.example.json config/user.json   # if needed
npm install
npm run build
npm run engage
```

Optional Postgres (from repo root):

```bash
docker compose up -d
```

Then set `DATABASE_URL` in `agent/.env` when persistence is enabled.

## Extension

```bash
cd extension
cp .env.example .env   # optional until API bridge
npm install
npm run build
# Chrome → chrome://extensions → Load unpacked → extension/dist

npm run dev            # Vite / CRX watch
```
