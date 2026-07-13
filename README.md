# Linkrowth

CLI that turns a LinkedIn post into a suggested comment and a one-line rationale — tuned to your niche and positioning.

## Quick start

**Requirements:** Node.js 18+, Docker, an API key for your chosen provider (OpenAI, Gemini, Anthropic, or Kimi).

```bash
git clone <repo-url> && cd linkrowth
npm install

cp config/user.example.json config/user.json   # edit niche, positioning, audience
cp .env.example .env                           # add your API key (+ DATABASE_URL)

npm run db:up                                  # Postgres via Docker Compose
npm run db:migrate                             # create posts + runs tables

npm run build
npm run engage
```

`engage` persists each post and run (including reasoning steps as JSON) to Postgres. It requires `DATABASE_URL` and a running database — there is no in-memory fallback.

Paste a post at the prompt, or pipe one in:

```bash
echo "Your post text here…" | npm run engage
```

Set the provider in `.env` (default is OpenAI):

```
LINKROWTH_PROVIDER=openai   # or gemini, anthropic, kimi
```
