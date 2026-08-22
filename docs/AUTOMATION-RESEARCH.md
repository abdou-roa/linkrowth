# Linkrowth automation research

**Status:** research only — no implementation in this PR  
**Goal:** map paths from today's human-in-the-loop product toward fuller feed engagement automation, with LinkedIn account safety and ToS risk as first-class constraints  
**Date:** 2026-08-22

---

## 1. Problem statement

Today Linkrowth:

1. Observes the LinkedIn feed via a Chrome MV3 extension (human present, scrolling)
2. Triages posts locally
3. Drafts comments via API → agent (`analyze → draft → refine`)
4. Leaves **shipping** to the human (composer fill + manual submit)

The desired north star for this research track:

> An agent that can open a browser session, authenticate to LinkedIn, surf the feed, and interact (comment / react) with less or no continuous human presence.

That north star collides with three realities:

| Reality | Implication |
|---|---|
| LinkedIn User Agreement §8.2 | Bots, unauthorized automation, scraping, and tools that auto-comment/like are **prohibited** |
| LinkedIn enforcement | Account restriction / shutdown is the common remedy; vendor-scale scraping can draw civil action |
| Linkrowth principles (current README) | Explicit non-goals: no headless automation, no autonomous posting, human-in-the-loop |

This document does **not** recommend “undetectable” evasion as a product strategy. It ranks architectures by **account risk**, **ToS exposure**, **fit with existing code**, and **product quality** (comment quality stays Linkrowth’s differentiator).

---

## 2. What LinkedIn officially allows and forbids

### 2.1 Prohibited (primary sources)

LinkedIn Help — [Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387) — states LinkedIn does **not** permit third-party software including crawlers, bots, browser plug-ins, or extensions that:

- scrape LinkedIn
- modify the appearance of the site
- **automate activity** on LinkedIn

User Agreement §8.2 (Dos and Don’ts) includes prohibitions on:

- software/scripts/robots/crawlers/plugins to scrape or copy the Services
- **bots or other unauthorized automated methods** to access the Services, send messages, **create, comment on, like, share, or re-share posts**, or otherwise drive inauthentic engagement
- overlaying / modifying the Services’ appearance
- bypassing access controls or use limits

**Practical reading:** any path that logs in programmatically and auto-posts comments without LinkedIn’s authorized APIs is a ToS violation for the member account. “Browser-based” or “human-like” does not make it permitted — it only changes **detection probability**.

### 2.2 Official APIs (authorized interfaces)

LinkedIn Marketing Developer Platform / Community Management APIs support comments and reactions in **approved** partner use cases:

| Capability | Typical scope | Fit for personal feed engagement? |
|---|---|---|
| Comments API | Create/read/edit/delete comments on shares | Strong for **organization pages** (`w_organization_social_feed`); member-level write exists (`w_member_social_feed`) but access is gated |
| Reactions API | Create/delete reactions | Same permission model as comments |
| Social Metadata API | Summaries of social actions | Mostly org / approved partner |
| `r_member_social_feed` | Read member posts/reactions | **Restricted** — select developers only |

Docs (Microsoft Learn / LinkedIn Marketing):

- [Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api)
- [Reactions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api)
- [Community Management overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)

**Gap vs Linkrowth thesis:** there is **no public, self-serve API** that returns a member’s algorithmic home feed and lets arbitrary third parties auto-engage on it. Official APIs are oriented to **Page / Community Management / ads**, not “surf my personal feed and comment like me.”

### 2.3 Legal vs platform risk (high level)

- Public scraping is generally **not** treated as a federal CFAA crime after *hiQ*-related holdings, but LinkedIn can still enforce **contract** (User Agreement) and restrict accounts.
- For Linkrowth users, the dominant risk is **account restriction**, reputation damage, and product breakage — not criminal exposure for ordinary personal use.
- This is **not legal advice**; product decisions should assume LinkedIn can restrict any account using unauthorized automation.

---

## 3. Solution space (architectures)

Five families. Risk is relative and qualitative.

```text
Lower account / ToS risk ◄──────────────────────────────────────► Higher risk

  A Official API     B Assisted HITL     C Semi-auto       D Real-browser     E Stealth / cloud
  (partner)          (today + ship UX)   (queued approve)  local agent        headless + evasion
```

### A — Official API / partner program

**How:** OAuth app; Community Management APIs for org (and gated member) social actions.

| Pros | Cons |
|---|---|
| Authorized channel; no DOM scraping | Does not solve personal feed discovery |
| Stable contracts vs fragile selectors | Partner approval lag / rejection likely for “growth bot” |
| Fits enterprise Page use cases | Wrong product shape for solo authority growth on the feed |

**Verdict for Linkrowth v1 automation:** explore only if the product expands to **company Page engagement**. Not a path to personal-feed automation.

### B — Assisted human-in-the-loop (extend current extension)

**How:** Keep session = user’s real Chrome LinkedIn login. Agent drafts; UX reduces friction to ship (one-click insert, optional “Approve & post” with explicit user gesture, daily queue in side panel).

| Pros | Cons |
|---|---|
| Matches current architecture (`extension/` → `api/` → `agent/`) | Not “fully automated” |
| Same device/IP/fingerprint as the human | Still technically an extension that modifies LinkedIn UI (already in ToS gray zone; LinkedIn lists extensions as restricted software) |
| Comment quality stays high (human gate) | Throughput capped by human attention |
| Aligns with README principles | Does not meet unattended north star |

**Verdict:** **recommended near-term.** Lowest incremental risk; compounds what already works.

### C — Semi-autonomous with hard approval gates

**How:** Extension (or local daemon) builds a **daily engagement queue**; agent drafts offline; user batch-approves; only approved items are submitted via the live page with an explicit “Run approved” action while the tab is open.

| Pros | Cons |
|---|---|
| Unattended *drafting* + triage | Submit still needs a live session |
| Clear audit trail of what ships | Auto-submit of an approved batch still automates commenting (ToS) |
| Rate limits easy to enforce in product | User may rubber-stamp → quality collapse |

**Verdict:** **best bridge** toward automation without jumping to remote stealth browsers. Product can market “you stay in control” while measuring whether users actually review.

### D — Local real-browser agent (visible / headed, user’s machine)

**How:** Local Playwright/Puppeteer/Chrome DevTools driving a **headed** browser profile that already holds the LinkedIn session (or user logs in once interactively). Agent scrolls feed, extracts posts, calls Linkrowth agent, types comments.

| Pros | Cons |
|---|---|
| Reuses real profile cookies / IP geography | Still unauthorized automation under §8.2 |
| Better fingerprint than datacenter headless | `navigator.webdriver` / CDP signals; LinkedIn actively detects automation frameworks |
| Full control for power users (self-host) | Fragile LinkedIn DOM (same as extension selectors) |
| Can enforce strict local rate limits | Credential/session security: agent process holds LinkedIn session |

**Verdict:** research prototype **only after** B/C prove demand — and only with loud ToS risk disclosure + conservative defaults. Prefer **reusing the user’s interactive login** over storing passwords in the agent.

### E — “Undetectable” / stealth / cloud headless

**How:** Headless Chrome + stealth patches, residential proxies, fingerprint spoofing, simulated mouse/typing, remote cloud browsers that log in and run 24/7.

| Pros | Cons |
|---|---|
| Matches the literal “fully automated” ask | Explicit ToS violation + highest ban risk |
| Unattended scale | Impossible-travel / datacenter IP / TLS fingerprint signals |
| | Arms race: stealth plugins leave their own signatures; CDP side-channels exist |
| | Product liability / trust: Linkrowth’s brand is “comments worth being seen,” not spam volume |
| | Conflicts with current public principles and #PromptToArchitecture narrative |

**Verdict:** **do not adopt as Linkrowth’s default architecture.** If explored at all, treat as a **rejected alternative** unless legal/partner posture changes. “Undetectable” is not a durable property against a platform that owns the server-side behavioral model.

---

## 4. Detection & account-risk model (what actually bites)

Industry and security write-ups converge on **layered** detection. Useful for product risk ranking — not as an evasion playbook.

| Layer | Signals (examples) | Relevance |
|---|---|---|
| Environment | Automation flags, missing plugins, headless artifacts, CDP side effects | High for Playwright/Puppeteer |
| Network / identity | Datacenter IP reputation, proxy reuse, geo jumps vs normal login | High for cloud agents |
| Session | Concurrent sessions, sudden new device, cookie reuse across IPs | High if agent + phone both active |
| Behavior | Uniform intervals, no scroll/read dwell, identical comment shapes, burst volume | High even for “real browser” tools |
| Content | Template-y comments, high similarity across posts, spam reports | Directly hurts Linkrowth’s quality thesis |
| Social graph | Low acceptance / ignore rates (more for outreach than comments) | Secondary for feed comments |

**Implication for Linkrowth:** the durable moat is **selective, high-quality comments**, not volume. Automation that maximizes actions/hour fights the product thesis and the platform simultaneously.

---

## 5. Account-safe operating envelope (if any automation ships)

LinkedIn does **not** publish official engagement caps. The numbers below are **practitioner consensus** from automation vendors/operators (2025–2026 public guides). Treat as **soft ceilings for product defaults**, not guarantees.

### 5.1 Conservative defaults for *feed engagement* (warmed personal account)

| Action | Conservative daily default | Aggressive (elevated risk) | Notes |
|---|---|---|---|
| Comments shipped | **5–15** | 30–40+ | Quality > count; space across waking hours |
| Reactions / likes | **20–40** | 50–100 | Prefer reacting on posts already triaged as worth_it |
| Profile deep-views while hunting | keep modest | 100+/day often cited as riskier | Prefer feed-native discovery |
| Total discrete social actions | aim **&lt; 80–100**/day early | ~150 total/day often cited as soft ceiling | Include manual activity |
| Connection requests | out of scope for v1 | ~100/week platform soft cap often reported | Separate product surface |

### 5.2 Warm-up & pacing (account safety)

1. **New or cold accounts:** week 1 mostly browse + very light manual engagement; ramp comments over 2–4 weeks.
2. **Jitter:** randomize delays between actions; avoid fixed cron “burst at 09:00.”
3. **Working hours:** confine activity to the user’s typical timezone and weekday pattern.
4. **One primary session:** avoid cloud login while the user is also mobile-active from another country.
5. **Human mixture:** keep a share of comments manually edited even if auto-drafted.
6. **Circuit breakers:** stop on CAPTCHA, checkpoint, unusual login challenge, or sudden UI errors; require human unlock.
7. **Similarity cap:** refuse to ship N near-duplicate comments in one day (agent already has voice/anti-AI refine — enforce at queue layer).
8. **Pause on warning:** any LinkedIn restriction UI → freeze automation for days, not minutes.

### 5.3 Credential & session hygiene

| Approach | Safety |
|---|---|
| User logs in interactively; agent reuses OS browser profile / cookies | Preferable to password storage |
| Store LinkedIn password in agent env / DB | **Avoid** — phishing surface, ToS, 2FA friction |
| SMS/email OTP automation | Fragile and high risk; keep human for challenges |
| Shared residential proxy pools | High correlation risk across customers |
| Dedicated local machine / always-on mini PC at user’s home IP | Lower geo risk than cloud VMs |

### 5.4 Product disclosures (non-negotiable if automation lands)

- Explicit ToS risk acknowledgment before enabling any auto-submit.
- Kill switch + daily caps with defaults **below** aggressive industry numbers.
- Audit log of every automated action (post id, timestamp, text, outcome).
- No dark-pattern “stealth mode” marketing; align public README if principles change.

---

## 6. Fit with current Linkrowth codebase

```text
Today:
  LinkedIn tab (human) → extension observe/extract/triage
                       → API suggestion jobs
                       → agent multi_step_engage
                       → composer fill (human submits)

Automation delta options:
  B/C: extend extension side panel → Engagement Queue + Approve/Ship
  D:   new package e.g. browser-agent/ driving headed Chrome + reuse extract/scoring ideas
  A:   new oauth + LinkedIn API client (org pages)
  E:   rejected default
```

Reusable assets:

| Asset | Reuse |
|---|---|
| `agent/` engage pipeline | Keep as brain for all paths |
| `api/` suggestion jobs | Queue + persistence for approved/shipped comments |
| `extension/` extract + scoring | DOM knowledge; selectors remain fragile |
| `extension/` composer helpers | Pattern for insert text; auto-submit is the ToS cliff |
| Postgres posts/jobs/runs | Audit trail for automation |

Suggested episode framing (if product chooses to proceed):

| Phase | Scope | Exit criteria |
|---|---|---|
| **Research** (this doc) | Options + risks | Product decision recorded |
| **Queue UX** | Side panel daily queue, batch approve, still manual submit | Users clear a queue without quality drop |
| **Assisted ship** | One-click post for *user-approved* drafts while tab focused | Measured save-rate / edit-rate |
| **Local agent spike** (optional) | Headed browser POC on owner account only | Ban/challenge incidence; no customer rollout |
| **Partner/API track** (optional) | Org Page community management | Only if Page use case is real |

---

## 7. Competitor / industry pattern (compressed)

Commercial LinkedIn “automation” tools cluster into:

1. **Cloud bots** — remote sessions, high ban anecdotes, ToS-hostile  
2. **Desktop/local helpers** — drive real browser, still ToS-hostile, somewhat safer fingerprints  
3. **Chrome extensions** — session-native; LinkedIn still lists them as prohibited when they automate  
4. **Official-ish integrations** — CRM / Page tools on Marketing APIs  

Almost all outreach-focused tools optimize **connection + DM volume**. Linkrowth’s differentiator should remain **selective expert comments**, which naturally wants **lower volume** and can use that as the account-safety story.

---

## 8. Recommendation

### Product recommendation (research conclusion)

1. **Do not** make “undetectable headless LinkedIn bot” the default Linkrowth architecture.
2. **Do** pursue a graduated automation ladder:
   - **Phase 1:** Engagement Queue + stronger HITL ship UX (architecture B/C)
   - **Phase 2:** Optional local headed agent for power users, with strict caps, circuit breakers, and ToS disclosure (architecture D) — only after Phase 1 demand is real
   - **Parallel optional:** Official API for **organization Page** community management (architecture A)
3. **Account-safe defaults** beat stealth: low daily comment caps, warm-up, jitter, human approval, audit logs, stop-on-challenge.
4. Update public **Principles & non-goals** in the README only when intentionally changing the product contract — do not silently contradict “human ships.”

### Explicit non-goals for immediate follow-up PRs

- No stealth/fingerprint-spoofing implementation
- No password-based LinkedIn login automation
- No cloud multi-tenant browser farm for customer accounts
- No claim of LinkedIn ToS compliance for auto-commenting

### Open decisions for the maintainer

1. Is the north star **unattended commenting**, or **maximum-quality assisted commenting**?
2. Acceptable customer risk: temporary restriction vs never risking the user’s primary career account?
3. Should automation be a separate package / SKU so the core remains HITL by default?
4. Is organization Page support in scope this year?

---

## 9. Sources

| Source | Role |
|---|---|
| [LinkedIn — Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387) | Platform policy |
| LinkedIn User Agreement §8.2 (Dos and Don’ts) | Contractual automation ban |
| [Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api) | Official write path |
| [Reactions API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api) | Official reactions |
| [Community Management overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview) | Approved use cases / restrictions |
| Practitioner limit guides (SocialNexis, We-Connect, Linked Helper, etc., 2026) | Soft rate envelopes only |
| Linkrowth `README.md` Principles & non-goals | Current product contract |

---

## 10. Next PR candidates (after decision)

| If decision is… | Next PR |
|---|---|
| Stay HITL, reduce friction | Side panel Engagement Queue + approve workflow |
| Semi-auto | Job states: `drafted → approved → shipped` in API/DB + circuit breakers |
| Local agent spike | Scaffold `browser-agent/` headed Chrome, interactive login only, dry-run mode (no submit) |
| Org Pages | OAuth app registration spike + Comments API read/write for a test Page |
