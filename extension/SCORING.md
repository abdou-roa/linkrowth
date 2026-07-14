# Extension scoring

Phase 1 triage scores feed posts **locally** in `extension/src/shared/scoring.ts`. No LLM. The result is a numeric `score`, human-readable `reasons[]`, and status `worth_it` | `not_worth_it`.

Source of inputs: `extension/src/content/extract.ts` → `FeedPost` (`text`, `metrics.likes`, `metrics.commentsCount`, `ageText`).

---

## Pass / fail

| Constant | Default | Meaning |
| --- | --- | --- |
| `worthItMin` | **50** | `score >= 50` → `worth_it`, else `not_worth_it` |

Side panel and store sort **Worth it** first, then by score descending — high scores float to the top.

---

## Core formula

```text
interactions = (likes ?? 0) + (comments ?? 0) × 3
hoursOld     = parseHoursOld(ageText)   // undefined if age missing / unparseable
```

Comments are weighted **3×** a like because they signal real conversation.

Missing likes are treated as `0` for the interaction total **but** several rules only run when likes were actually extracted (`likesKnown`). LinkedIn often hides reaction counts while comment counts still appear.

---

## Age (`ageText` → `hoursOld`)

Extracted in this order:

1. **DOM** near the actor (labels like `15m`, `2h`, `1d`, `1w`, `Just now`)
2. **Fallback:** LinkedIn activity / ugcPost snowflake ID (first 41 bits = Unix ms) → relative label

| Label | Hours |
| --- | --- |
| `just now` / `now` | ≈ 0.017 (1 minute floor) |
| `Nm` / minutes | `N / 60` |
| `Nh` / hours | `N` |
| `Nd` / days | `N × 24` |
| `Nw` / weeks | `N × 7 × 24` |
| `Nmo` / months | `N × 30 × 24` |

---

## Decision flow

```text
1. Dead rule?  → score 0, not_worth_it, stop
2. Add text points
3. Branch:
     age < 1h AND interactions < 5  → grace (text only)
     age unknown                    → absolute engagement
     else                           → velocity + interactivity
4. score >= 50 ? worth_it : not_worth_it
```

Rules in a branch **stack** (points add). Reasons are appended as each rule hits.

---

## Rules

### 1. Dead rule (hard reject)

Runs **only** when age and likes are known:

| Condition | Result |
| --- | --- |
| `hoursOld > 12` **and** `likes < 5` **and** `comments < 2` | Score **0**, `not_worth_it`, reason `old with no traction` |

Skipped when likes were not extracted (avoids false rejects).

### 2. Text richness (always)

| Text length (trimmed) | Points | Reason |
| --- | --- | --- |
| ≥ 280 | +25 | `substantive text` |
| ≥ 80 | +15 | `moderate text` |
| > 0 | +5 | `thin text` |
| empty | +0 | `empty text` |

### 3. Grace period

| Condition | Effect |
| --- | --- |
| `hoursOld < 1` **and** `interactions < 5` | No engagement points; reason `too new to judge metrics` |

Fresh posts are not punished for cold metrics yet.

### 4. Velocity path (age known, not in grace)

| Rule | Condition | Points | Reason |
| --- | --- | --- | --- |
| Highly interactive | `comments ≥ 15` **or** `comments/hour ≥ 5` | +50 | `highly interactive` |
| Some comments | else if `comments ≥ 5` | +15 | `some comments` |
| High velocity | `hoursOld < 12` **and** `interactions/hour ≥ 15` | +40 | `high velocity` |
| Early traction | `hoursOld < 2` **and** `interactions ≥ 10` | +30 | `strong early traction` |
| Steady engagement | `hoursOld ≥ 1` **and** likes known | +`min(30, round(interactions/hour))` | `steady engagement` |
| Comment velocity | `hoursOld ≥ 1` **and** likes unknown **and** comments > 0 | +`min(15, round((comments×3)/hour))` | `comment velocity` |

If likes are missing, reason `likes unknown` is also added (informational; no points).

Rates use `safeHours = max(hoursOld, 1/60)` so “just now” never divides by zero.

### 5. Absolute path (age unknown)

Used when `ageText` is missing or unparseable. Reason always includes `age unknown`.

| Rule | Condition | Points | Reason |
| --- | --- | --- | --- |
| Highly interactive | `comments ≥ 15` | +50 | `highly interactive` |
| Some comments | `comments ≥ 5` | +15 | `some comments` |
| High engagement | `interactions ≥ 80` | +30 | `high engagement` |
| Some engagement | `interactions ≥ 20` | +15 | `some engagement` |

---

## Worked examples

**A. Hot young thread** — 1h old, 20 likes, 8 comments, long text  

- Text +25  
- Interactions = 20 + 24 = 44 → rate 44/h  
- Some comments +15, high velocity +40, early traction +30, steady +30  
- Score ≫ 50 → `worth_it` (floats to top)

**B. Old flop (likes known)** — 2d old, 2 likes, 0 comments  

- Dead rule → score **0**, `not_worth_it`

**C. Age known, likes missing, 45 comments, long text**  

- Text +25  
- Highly interactive +50  
- Comment velocity soft credit  
- → `worth_it` (not killed by dead rule)

**D. Brand new** — 10m old, 0 engagement, long text  

- Grace → text only (+25) → `not_worth_it` until traction or more text/signal later

---

## Where to tune

| Goal | File |
| --- | --- |
| Points, thresholds, dead/grace/velocity | `extension/src/shared/scoring.ts` |
| Age / likes / comments extraction | `extension/src/content/extract.ts` |
| Badge label (score · likes) | `extension/src/content/badge.ts` |
| Side panel row (age · likes · comments) | `extension/src/sidepanel/main.ts` |

Pass threshold and formulas are intentional stubs for Phase 1 — tune without touching the `agent/` package.
