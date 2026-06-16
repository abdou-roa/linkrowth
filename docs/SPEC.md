# Linkrowth — Technical & Functional Specification

> Living document. Updated as each episode ships. Decisions logged with rationale.

**Last updated:** 2026-06-15  
**Current episode:** 1 (shipped)  
**Status:** Episode 1 implemented — see [`EPISODE-1.md`](./EPISODE-1.md)

---

## 1. Problem statement

Growing on LinkedIn as a technical person is a *being-seen* problem, not a posting problem. The highest-leverage move is thoughtful engagement on the right posts — but doing it consistently, on posts that matter, in a way that signals expertise, is exactly the part that decays.

Generic AI comment generators produce "Great insights! 🔥" — invisible at best, embarrassing at worst.

---

## 2. Core abstraction

One surface-agnostic function, everything else is a consumer of it:

```
engage(post, context) → { suggestion, rationale }
```

| Param | Type | Description |
|---|---|---|
| `post` | `string` | The LinkedIn post text. Optional author/role metadata. |
| `context` | `UserContext` | User's niche, positioning, voice, target audience. |
| `suggestion` | `string` | A comment that demonstrates expertise and invites a reply. |
| `rationale` | `string` | One line explaining why this comment serves the goal. |

**Invariant:** this signature must remain stable across all episodes. New layers are added *around* it, not inside it.

---

## 3. Quality rubric

Every comment produced by `engage()` is evaluated against:

1. Demonstrates genuine technical insight
2. Substantive enough that a skimming recruiter or client stops on it
3. Signals domain expertise without being salesy
4. Adds to the conversation and invites a reply
5. *(Episode 2+)* Sounds like the user, not a generic AI

---

## 4. Episode ladder

Each episode adds exactly one layer. A layer is only added when the previous one has a *visible*, demonstrable failure.

| Episode | Layer | Failure it fixes | Status |
|---|---|---|---|
| 1 | `engage()` core + paste-in CLI | "Generic — sounds like everyone" | `shipped` |
| 2 | Voice: past writing as context | "Right voice, but why this post?" | `planned` |
| 3 | Triage: score whether a post is worth engaging | "Good comment, I still hunt posts manually" | `planned` |
| 4 | Browser extension surfaces the feed | "It forgets who I've already talked to" | `planned` |
| 5 | Memory: relationships, history, no repeats | "One-shot drafts are mediocre" | `planned` |
| 6 | Critic loop: draft, tone/authority check, revise | "It's a pile of scripts" | `planned` |
| 7 | Orchestration: daily prioritized engagement queue | Season finale / X port | `planned` |

---

## 5. Episode 1 spec

> **Working scope & ship checklist:** [`EPISODE-1.md`](./EPISODE-1.md)

### Functional requirements

- Accept a LinkedIn post via CLI (stdin or piped string)
- Return one suggested comment
- Return one-line rationale for the suggestion
- Comment must pass rubric items 1–4

### Deliberately excluded

- No voice (no user writing as context)
- No post triage / scoring
- No memory of past interactions
- No self-critique loop
- No feed access (manual paste only)

### Interface

```
$ linkrowth engage
> Paste a post and press Enter (or Ctrl+D when done):
[post text]

Suggestion:
[comment text]

Why:
[one-line rationale]
```

### Implementation

- **Language:** TypeScript
- **Runtime:** Node.js
- **AI:** Single OpenAI API call — no agentic loop, no framework
- **System prompt:** encodes the goal rubric; no user voice context yet
- **Target size:** ~30–50 lines of meaningful code
- **No framework until the architecture earns one**

### System prompt contract (Episode 1)

The system prompt must communicate:
1. The commenter's goal (authority-signaling, not generic agreeableness)
2. The rubric (insight, substance, expertise, invites reply)
3. Output format (suggestion + rationale, clearly separated)

*Logged in [`EPISODE-1.md`](./EPISODE-1.md) §7 and implemented in `src/prompts.ts`.*

---

## 6. Tech stack decisions

| Concern | Decision | Rationale | Revisit trigger |
|---|---|---|---|
| Language | TypeScript | Type safety matters as the schema evolves; same language for future browser extension | — |
| AI provider | OpenAI (`gpt-4o-mini`) | Free trial credits for early development; swap via `clients/` when needed | If instruction-following quality becomes a visible failure |
| Framework | None (raw API calls) | No framework earns its place until Episode 3+ complexity | When `engage()` needs to chain calls or manage state |
| CLI framework | None (basic Node.js readline or argv) | Zero deps for Episode 1 | When CLI UX becomes a visible failure |
| Package manager | npm | Default; no strong reason to deviate yet | — |
| Deployment | Local CLI only | Scope is intentionally minimal | Episode 4 (browser extension) |

---

## 7. Data model (evolving)

### Episode 1

```typescript
interface Post {
  text: string;
  author?: { name?: string; role?: string };
}

interface UserContext {
  niche: string;
  positioning: string;
  targetAudience: string;
}

interface EngageResult {
  suggestion: string;
  rationale: string;
}

interface LlmRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}
```

### Planned additions by episode

| Episode | New types |
|---|---|
| 2 | `VoiceSample[]` — past writing examples |
| 3 | `TriageScore` — post relevance score + reasoning |
| 5 | `RelationshipMemory` — interaction history per author |
| 6 | `CritiqueResult` — tone/authority check output |
| 7 | `EngagementQueue` — prioritized list of scored posts |

---

## 8. File structure (Episode 1 target)

```
linkrowth/
├── src/
│   ├── engage.ts        # core engage() function — the stable public API
│   ├── cli.ts           # CLI entry point — thin consumer of engage()
│   ├── prompts.ts       # all prompt strings as typed builder functions; no prompt logic elsewhere
│   ├── llm.ts           # provider-agnostic call() — routes to a client; no HTTP/SDK logic here
│   ├── types.ts         # shared interfaces (Post, UserContext, EngageResult, LlmRequest, …)
│   ├── config/
│   │   └── env.ts       # .env loading, provider selection, API key validation
│   └── clients/
│       ├── claude.ts    # Anthropic client (future)
│       ├── gpt.ts       # OpenAI client (Episode 1 default)
│       ├── gemini.ts    # Google Gemini client
│       └── kimi.ts      # Kimi / Moonshot client (future)
├── config/
│   ├── user.json        # user context (niche, positioning, audience) — gitignored
│   └── user.example.json
├── docs/
│   ├── SPEC.md          # this file
│   ├── CONTENT-STRATEGY.md
│   └── POSTING-PLAYBOOK.md
├── package.json
├── tsconfig.json
└── README.md
```

### Module responsibilities

**`prompts.ts`**  
Exports pure builder functions — they take typed arguments and return a `{ system, user }` pair. No API calls, no side effects. Keeping prompts here means every prompt change is a single-file diff and the content is independently testable.

```typescript
// prompts.ts
import type { Post, UserContext } from "./types";

export function buildEngagePrompt(
  post: Post,
  context: UserContext
): { system: string; user: string } {
  return {
    system: `...`,  // rubric, goal, output format
    user: `...`,    // the post + author context
  };
}
```

**`llm.ts`**  
Provider-agnostic entry point. Exports a single `call()` that the rest of the codebase uses. Routes to the active client in `clients/` — no HTTP or SDK imports here. Cross-cutting concerns (default model, retries, provider selection) live here as they earn their place.

```typescript
// llm.ts
import { call as gptCall } from "./clients/gpt";
import type { LlmRequest } from "./types";

export async function call(request: LlmRequest): Promise<string> {
  // Episode 1: OpenAI only. Later: select client from config/env.
  return gptCall(request);
}
```

**`clients/`**  
One file per LLM provider. Each client owns its SDK/HTTP setup and exports a `call(request: LlmRequest): Promise<string>`. Nothing outside `clients/` imports provider SDKs directly.

```typescript
// clients/gpt.ts
import OpenAI from "openai";
import type { LlmRequest } from "../types";

const client = new OpenAI(); // reads OPENAI_API_KEY from env

export async function call(request: LlmRequest): Promise<string> {
  const response = await client.chat.completions.create({
    model: request.model ?? "gpt-4o-mini",
    max_tokens: request.maxTokens ?? 1024,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Unexpected response from OpenAI");
  return content;
}
```

`clients/claude.ts` and `clients/kimi.ts` follow the same `call()` contract. Episode 1 ships `gpt.ts` (default) and `gemini.ts`.

```typescript
// clients/gemini.ts
import { GoogleGenAI } from "@google/genai";
import type { LlmRequest } from "../types";

const ai = new GoogleGenAI({}); // reads GEMINI_API_KEY from env

export async function call(request: LlmRequest): Promise<string> {
  const response = await ai.models.generateContent({
    model: request.model ?? "gemini-2.5-flash",
    contents: request.user,
    config: {
      systemInstruction: request.system,
      maxOutputTokens: request.maxTokens ?? 1024,
    },
  });
  const text = response.text;
  if (!text) throw new Error("Unexpected response from Gemini");
  return text;
}
```

---

## 9. Configuration

### User context

User context loaded from `config/user.json` (not committed — `.gitignore`d). Template:

```json
{
  "niche": "",
  "positioning": "",
  "targetAudience": "",
  "voiceSamples": []
}
```

`config/user.example.json` committed as documentation.

### Environment variables (secrets)

API keys and provider selection live in `.env` (never committed). Copy `.env.example` to `.env`.

| Variable | Required | Description |
|---|---|---|
| `LINKROWTH_PROVIDER` | No | Active client: `openai` (default), `gemini`, `anthropic`, `kimi` |
| `OPENAI_API_KEY` | If provider=openai | OpenAI API key |
| `GEMINI_API_KEY` | If provider=gemini | Google AI Studio key |
| `ANTHROPIC_API_KEY` | If provider=anthropic | Anthropic API key |
| `KIMI_API_KEY` | If provider=kimi | Moonshot / Kimi API key |
| `LINKROWTH_OPENAI_MODEL` | No | Default OpenAI model (default: `gpt-4o-mini`) |
| `LINKROWTH_GEMINI_MODEL` | No | Default Gemini model (default: `gemini-2.5-flash`) |
| `LINKROWTH_ANTHROPIC_MODEL` | No | Default Anthropic model (default: `claude-sonnet-4-6`) |
| `LINKROWTH_KIMI_MODEL` | No | Default Kimi model (default: `moonshot-v1-8k`) |

Loaded by `src/config/env.ts` via `dotenv`. Only the active provider's API key is validated at runtime. CLI calls `validateEnv()` on startup for fail-fast errors.

---

## 10. Non-goals (across all episodes)

- **No scraping / ToS violations.** Feed access (Episode 4) will be via browser extension with the user present — no automation of posting or liking.
- **No autonomous posting.** The agent suggests; the human ships. Always human-in-the-loop.
- **No web service / SaaS.** CLI first, browser extension second. No server infra until it visibly earns it.

---

## 11. Open questions

| Question | Episode | Notes |
|---|---|---|
| Where do voice samples live — inline JSON or a flat text file? | 2 | Flat text is simpler to edit; JSON is queryable |
| Triage: LLM-scored or heuristic-first? | 3 | Heuristic (keyword match) may be sufficient; LLM if it visibly fails |
| Browser extension: Chrome MV3 or cross-browser? | 4 | Chrome-first, YAGNI on Firefox until there's demand |
| Memory store: SQLite or flat JSON? | 5 | SQLite for queryability; JSON if schema stays simple |
| Critic loop: same model or a second call with a different persona? | 6 | Second call with explicit critic role; same model is fine |

---

## 12. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-12 | Start with TypeScript + raw API, no framework | Earn your complexity — no framework until the architecture demands one |
| 2026-06-12 | `engage()` as the stable core abstraction | CLI and browser extension are both consumers of the same function; keeps surfaces independent |
| 2026-06-15 | Add `clients/gemini.ts` | Google Gemini offers strong price/performance; same `call()` contract as other providers |
| 2026-06-15 | Episode 1 shipped | CLI + engage() + OpenAI/Gemini clients; MIT; README quick start |
