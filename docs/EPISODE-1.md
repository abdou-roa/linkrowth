# Episode 1 — `engage()` core + paste-in CLI

> **Canonical spec:** [`SPEC.md`](./SPEC.md) · **Content plan:** [`CONTENT-STRATEGY.md`](./CONTENT-STRATEGY.md) §8 Week 1  
> **Status:** `closed` · **Implementation:** `shipped` · **Last updated:** 2026-06-15

---

## 1. What this episode is

**Layer:** `engage(post, context) → { suggestion, rationale }` + a thin CLI that pastes a post and prints the result.

**Villain it fixes:** *"Generic — sounds like everyone."*  
A one-shot "write me a comment" prompt produces competent, forgettable agreeableness. This episode establishes the **baseline** — intentionally naive — so every later layer has a visible before/after.

**Thesis beat for content:** *Earn your complexity.* One prompt, one API call, no framework. Ship the dumbest version that runs, name what it can't do, tease Episode 2 (voice).

---

## 2. Problem context (from SPEC)

Growing on LinkedIn as a technical person is a **being-seen** problem, not a posting problem. The highest-leverage move is thoughtful engagement on the right posts — but doing it consistently, on posts that matter, in a way that signals expertise, is exactly the part that decays.

Generic AI comment generators produce *"Great insights! 🔥"* — invisible at best, embarrassing at worst.

**End state (the ladder):** prioritized queue of posts worth your time, each paired with a draft that sounds like you and signals expertise. Episode 1 is rung one: paste a post, get a suggestion, see the gap.

---

## 3. Core abstraction (stable across all episodes)

```
engage(post, context) → { suggestion, rationale }
```

| Param | Type | Episode 1 behavior |
|---|---|---|
| `post` | `Post` | Pasted via CLI stdin (interactive or piped). Optional `author` — API only, not CLI. |
| `context` | `UserContext` | Loaded from `config/user.json` (niche, positioning, target audience). No voice samples used. |
| `suggestion` | `string` | One comment aimed at authority-signaling, not generic agreeableness. |
| `rationale` | `string` | One line: why this comment serves the goal. |

**Invariant:** this signature stays stable. New layers wrap it; they don't change it.

---

## 4. Quality rubric (Episodes 1–4)

Every comment is evaluated against:

1. Demonstrates genuine technical insight
2. Substantive enough that a skimming recruiter or client stops on it
3. Signals domain expertise without being salesy
4. Adds to the conversation and invites a reply
5. *(Episode 2+)* Sounds like the user, not a generic AI

Episode 1 optimizes for 1–4 via the system prompt only. Rubric item 5 is **deliberately out of scope** — that's the Episode 2 villain.

---

## 5. Functional scope

### In scope

- [x] Accept a LinkedIn post via CLI (`linkrowth engage`, stdin / pipe)
- [x] Single LLM call — no agent loop, no framework
- [x] Return one suggested comment + one-line rationale
- [x] System prompt encodes goal + rubric (items 1–4) + output format
- [x] User context from `config/user.json` (niche, positioning, audience)
- [x] Provider-agnostic `llm.call()` with OpenAI default; Gemini implemented
- [x] `.env` for API keys and provider selection; fail-fast on startup
- [x] **Ship check:** `npm run build` + `npm run engage` documented in README
- [x] MIT license committed
- [ ] **Manual:** run end-to-end on 3–5 real posts; capture good + bad outputs for content
- [ ] **Manual:** repo public, bio links updated

### Deliberately excluded

| Excluded | Why | Which episode |
|---|---|---|
| Voice / past writing as context | Next visible failure | 2 |
| Post triage / scoring | Still hunting posts manually | 3 |
| Browser extension / feed access | Manual paste only | 4 |
| Memory of past interactions | One-shot drafts | 5 |
| Critic / revise loop | Mediocre one-shots | 6 |
| Daily queue orchestration | Season finale | 7 |

---

## 6. Interface contract

### CLI

```bash
# Interactive
npm run dev          # tsx src/cli.ts engage
npm run engage       # node dist/cli.js engage (after build)

# Piped
echo "Post text here…" | npm run dev
```

```
$ linkrowth engage
Paste a post and press Enter (or Ctrl+D when done):
[post text]

Suggestion:
[comment text]

Why:
[one-line rationale]
```

### Programmatic (stable API)

```typescript
import { engage } from "./engage";

const result = await engage(
  { text: "…", author: { name: "Jane", role: "Staff Engineer" } },
  { niche: "…", positioning: "…", targetAudience: "…" }
);
// → { suggestion: string, rationale: string }
```

---

## 7. System prompt (logged)

Implemented in `src/prompts.ts` → `buildEngagePrompt()`.

**System message communicates:**
1. Goal: authority-signaling comments for recruiters/clients — not generic agreeableness
2. Rubric: insight, substance, expertise without sales, invites reply
3. Commenter context: niche, positioning, target audience (from `user.json`)
4. Output format: `Suggestion:` / `Why:` sections, no extras

**User message:** optional author line + post text.

**Response parsing:** `engage.ts` expects `Suggestion:\n…\n\nWhy:\n…` — throws if malformed.

---

## 8. Data model (Episode 1)

```typescript
interface Post {
  text: string;
  author?: { name?: string; role?: string };
}

interface UserContext {
  niche: string;
  positioning: string;
  targetAudience: string;
  voiceSamples?: string[];  // present in schema, unused until Episode 2
}

interface EngageResult {
  suggestion: string;
  rationale: string;
}
```

**User config template** (`config/user.example.json`):

```json
{
  "niche": "AI engineering and agent systems",
  "positioning": "Builder who ships real systems in public, not hype",
  "targetAudience": "Tech recruiters and potential clients evaluating AI expertise",
  "voiceSamples": []
}
```

Copy to `config/user.json` (gitignored) before first run.

---

## 9. Tech decisions (Episode 1)

| Concern | Decision | Notes |
|---|---|---|
| Language | TypeScript | Types evolve with the ladder |
| AI | Single provider call via `llm.call()` | Default `gpt-4o-mini`; swap via `LINKROWTH_PROVIDER` |
| Framework | None | Raw SDK calls in `clients/` |
| CLI | Node readline, no CLI framework | Zero deps for UX |
| Deployment | Local CLI only | Extension is Episode 4 |
| Secrets | `.env` (never commit) | `validateEnv()` on CLI startup |

### Environment

| Variable | Required | Default |
|---|---|---|
| `LINKROWTH_PROVIDER` | No | `openai` |
| `OPENAI_API_KEY` | If provider=openai | — |
| `GEMINI_API_KEY` | If provider=gemini | — |
| `LINKROWTH_OPENAI_MODEL` | No | `gpt-4o-mini` |
| `LINKROWTH_GEMINI_MODEL` | No | `gemini-2.5-flash` |

`anthropic` / `kimi` clients are stubs — throw if selected.

---

## 10. File map & build state

```
src/
├── engage.ts        ✅ orchestration: context → prompt → LLM → parse
├── cli.ts           ✅ stdin + print; `linkrowth engage`
├── prompts.ts       ✅ buildEngagePrompt()
├── llm.ts           ✅ routes to active client
├── types.ts         ✅ Post, UserContext, EngageResult, LlmRequest
├── config/env.ts    ✅ dotenv, provider selection, validateEnv()
└── clients/
    ├── gpt.ts       ✅ OpenAI — Episode 1 default
    ├── gemini.ts    ✅ Google Gemini
    ├── claude.ts    ⬜ stub
    └── kimi.ts      ⬜ stub
```

**~515 lines** across `src/` (above the original 30–50 line aspiration — provider routing and env added early; core `engage` path is still thin).

Data flow:

```
cli.ts → engage.ts → prompts.ts + llm.ts → clients/gpt.ts | gemini.ts
```

---

## 11. Acceptance criteria (ship gate)

Episode 1 ships when all of the following are true:

1. **Runs:** `npm run build && npm run engage` with a real API key and `config/user.json`
2. **Output shape:** every successful run prints `Suggestion` + `Why` (or a clear error)
3. **Rubric spot-check:** manually run 5 diverse posts; at least 3 pass rubric 1–4; failures documented as content fodder
4. **Baseline villain is visible:** outputs are *better than* "Great post!" but still noticeably generic vs. your voice — enough to justify Episode 2
5. **Repo artifact:** public GitHub, README matches reality, `user.example.json` + `.env.example` committed
6. **Content captured:** screen recording of CLI + 2–3 screenshot failures in `captures.md` (or notes)

---

## 12. Demo posts (dogfood these)

Use real LinkedIn posts you might engage on. Record inputs + outputs.

| # | Post theme | What to watch for |
|---|---|---|
| 1 | Hot take / opinion piece | Does it add insight or just agree? |
| 2 | Technical tutorial / how-to | Does it demonstrate domain knowledge? |
| 3 | Hiring / career post | Does it signal expertise without being salesy? |
| 4 | AI hype post | Does it avoid sycophancy and add substance? |
| 5 | Short ambiguous post | Does it invite a reply or dead-end? |

**Capture template:**

```
### Post N — [theme]
**Input:** [paste or link]
**Output suggestion:** …
**Output why:** …
**Rubric pass?** 1–4 yes/no + note
**Villain note:** what still feels generic / wrong
```

---

## 13. Content plan (Week 1)

From `CONTENT-STRATEGY.md` and `POSTING-PLAYBOOK.md`. Atomize this episode into:

| Post | Angle | Platform | Status |
|---|---|---|---|
| **Flagship** | 30-line baseline; show it run; name the soulless comment | LinkedIn + X thread | `draft` |
| **Artifact** | Screen recording of CLI | X | `capture needed` |
| **Decision** | Why zero frameworks on day one | LinkedIn | `draft` |
| **Principle** | Competence ≠ being seen | Either | `optional` |

**Hook (flagship):** *"I gave an AI a single prompt to grow my LinkedIn. It wrote a perfectly competent comment — and that's exactly the problem."*

**Episode 2 tease (the new villain):** *"It sounds like everyone. Next: I give it my voice."*

**Series tag:** `#PromptToArchitecture`

Worked examples live in `POSTING-PLAYBOOK.md` § "Fully worked example — Episode 1 flagship".

---

## 14. Non-goals (reminder)

- No scraping / ToS violations
- No autonomous posting — human ships every comment
- No web service / SaaS
- No voice, triage, memory, critic, or feed — see §5 excluded table

---

## 15. Resolved decisions (spec closed)

| Question | Decision | Rationale |
|---|---|---|
| Author metadata in CLI? | **Skip** — API accepts `post.author`; CLI does not collect it | Extension (Episode 4) owns feed context; keep CLI minimal |
| Demo provider for flagship? | **OpenAI** (`gpt-4o-mini`) | Consistent demo; Gemini documented as swap |
| Rubric bar for ship? | **Subjective manual check** — 3/5 posts pass rubric 1–4 | Baseline villain must still feel generic vs. your voice |
| Piped stdin? | **Supported** — no prompt when stdin is not a TTY | `echo "…" \| npm run engage` |
| Missing `user.json`? | **Fail fast** with copy-from-example message | Clear setup path |

---

## 16. After ship

1. Update `SPEC.md`: `Current episode: 1 (shipped)`, log any decision deltas
2. Start `docs/EPISODE-2.md` when the voice villain is visible on real output
3. Friday metrics log: who commented, any inbound, saves/shares on flagship

---

## 17. Decision log (Episode 1)

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-12 | `engage()` as stable core | CLI and future extension share one brain |
| 2026-06-12 | TypeScript, no framework | Earn complexity |
| 2026-06-15 | Gemini client alongside OpenAI | Price/performance; same `call()` contract |
| 2026-06-15 | User context in prompt without voice samples | Niche/positioning/audience steer tone; voice is Episode 2 |
| 2026-06-15 | Skip author metadata in CLI | Extension owns feed context; API stays flexible |
| 2026-06-15 | Piped stdin without prompt | Better scripting UX; same read path |
