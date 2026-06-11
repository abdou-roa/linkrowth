# Linkrowth

> **Earn your complexity.** Start with one prompt. Add the next layer only when the current one visibly fails.

An AI engagement agent for LinkedIn (and later X) — built in public, one layer at a time.

Linkrowth helps you identify posts worth engaging with, drafts substantive comments aligned with a defined goal, and over time learns your voice, your network, and what actually builds authority. The project is also a content series: *From One Prompt to a Fully Architected Agent System* — every engineering milestone is an episode.

---

## The problem

Growing on LinkedIn as a technical person isn't a posting problem — it's a *being-seen* problem. The highest-leverage move is thoughtful engagement on the right posts, but doing it consistently, on posts that matter, in a way that signals expertise to recruiters and clients, is exactly the part that decays.

A "write me a comment" prompt produces *"Great insights! 🔥"* — invisible at best, embarrassing at worst.

---

## Architecture principle

The core is one surface-agnostic function:

```
engage(post, context) → { suggestion, rationale }
```

- **`post`** — the text being responded to (+ optional author/role).
- **`context`** — your config: niche, positioning, target audience.
- **`suggestion`** — a comment that demonstrates expertise and invites a reply.
- **`rationale`** — one line explaining why this serves the goal.

The CLI is the first consumer of this function. A future browser extension will be another — same brain, new surface.

---

## The ladder

Each layer earns its place by fixing a visible failure in the one before it.

| Episode | Layer | Failure it fixes |
|---|---|---|
| 1 | `engage()` core + paste-in CLI | "Generic — sounds like everyone" |
| 2 | Voice — past writing as context | "Right voice, but why this post?" |
| 3 | Triage — score whether a post is worth engaging | "Good comment, I still hunt posts manually" |
| 4 | Browser extension surfaces the feed | "It forgets who I've already talked to" |
| 5 | Memory — relationships, history, no repeats | "One-shot drafts are mediocre" |
| 6 | Critic loop — draft → tone/authority check → revise | "It's a pile of scripts" |
| 7 | Orchestration — daily prioritized engagement queue | Season finale / X port |

---

## Episode 1 scope

- **In:** a LinkedIn post (pasted via CLI)
- **Out:** one suggested comment + one-line rationale
- **Brain:** single Claude API call, system prompt encodes the goal rubric
- **Deliberately absent:** no voice, no triage, no memory, no self-critique, no feed access

The baseline is *intentionally naive*. That's the point.

---

## Tech stack

- **Language:** TypeScript
- **AI:** Claude API (thin custom SDK — no framework until the architecture earns one)
- **Surface v1:** CLI
- **Surface v2 (planned):** Browser extension (same core, new consumer)

---

## Goal

Every engagement the agent drafts is optimized against one rubric:

1. Demonstrates genuine technical insight
2. Substantive enough that a skimming recruiter or client stops on it
3. Signals domain expertise without being salesy
4. Adds to the conversation and invites a reply
5. *(later)* Sounds like you, on a post worth your time

---

## Follow the build

This repo is the artifact behind a LinkedIn/X series. Each episode ships a working layer and a post explaining the failure that motivated it.

Series tag: **#PromptToArchitecture**

