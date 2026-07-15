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

**Requirements:** Node.js 18+, Docker, an API key for your chosen provider (OpenAI, Gemini, Anthropic, or Kimi).

```bash
cd agent
cp .env.example .env                           # add your API key (+ DATABASE_URL)
cp config/user.example.json config/user.json   # edit niche, positioning, audience
npm install

npm run db:up                                  # Postgres via root docker-compose.yml
npm run db:migrate                             # create posts + runs tables

npm run build
npm run engage
```

`engage` persists each post and run (including reasoning steps as JSON) to Postgres. It requires `DATABASE_URL` and a running database — there is no in-memory fallback.

Paste a post at the prompt, or pipe one in:

```bash
echo "Your post text here…" | npm run engage
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
