# Linkrowth — Posting Playbook

Operational companion to `CONTENT-STRATEGY.md`. Two parts:
**A. The routine** (when & how you produce) · **B. The posts** (how each one is built).

---

# Part A — The posting routine

## The core idea: the build *is* the calendar
You never sit down to "think of content." Each episode (one engineering milestone) already contains 5–7 posts (see Strategy §3). Your routine's only job is to **capture** that raw material as you build and **shape** it into posts. So the routine has two habits running in parallel:

1. **Capture-as-you-build** (continuous) — the input.
2. **A weekly production cycle** (batched) — the output.

## Habit 1 — Capture as you build (0 extra effort, huge payoff)
Keep one scratch doc (`captures.md` or a notes app). While building, drop in:
- Screenshots of failures / ugly output / errors → these become **Villain** posts.
- Screen recordings of the CLI running → **Artifact** posts.
- Decisions you made and rejected ("didn't add X because…") → **Decision** posts.
- One-line realizations → **Principle** posts.
- Time spent, dead ends, surprises → **BTS** posts.

Rule: **if it surprised you, screenshot it.** Surprise is the raw material of engagement.

## Habit 2 — The weekly production cycle

| Day | Block | Time | What you do |
|---|---|---|---|
| **Sunday** | Plan & batch | 60–90 min | Pick the week's episode beat. Draft the flagship + 2–3 supporting posts from your captures. Schedule them. |
| **Tue/Wed/Thu** | Publish | 5 min | Flagship + supporting posts go out (scheduled). Drop any in-body links into the first comment. |
| **Daily (Mon–Fri)** | Engage | 15–30 min | Leave substantive comments on others' posts (this *is* your project — dogfood it). Reply to every comment on your own posts. |
| **First 60–90 min after posting** | Reply window | live | Be present. Early comments drive reach. This is the highest-ROI 30 min of your week. |
| **Friday** | Capture sweep | 10 min | Tidy `captures.md`, screen-record anything filmable, queue ideas for next Sunday. |

## The publishing slots (default — tune to your analytics)
- **LinkedIn:** Tue / Wed / Thu, ~8–10am audience time. One flagship + one supporting across the three days.
- **X:** one thread (same day as the LinkedIn flagship) + 4–7 small posts spread through the week.
- **Same idea, both platforms, same day, rewritten native** — never paste one into the other.

## The non-negotiable floor (for busy weeks)
When the build eats the week, ship only this and the pillar still survives:
1. **One flagship post** (even if it's just "here's where I'm stuck").
2. **The daily engagement block.**

Everything else is upside. Consistency of the floor beats heroic weeks followed by silence.

## Tools (keep it light)
- **Scheduler:** Typefully or Hypefury (X), native LinkedIn scheduler or Buffer. Schedule on Sunday, forget during the week.
- **Capture:** one notes doc + a screen-recorder (CleanShot / QuickTime / Loom).
- **Swipe file:** a running list of hooks that stopped *your* scroll — steal structures, not words.

## Track weekly (5 min, Friday)
Log per post: impressions, saves/shares, *who* meaningfully commented, and any inbound DM/InMail. Watch **who engages**, not just how many (Strategy §7).

---

# Part B — How the posts should be put together

## Universal anatomy (every post, both platforms)
```
1. HOOK      — 1–2 lines. Stops the scroll. Works alone, out of context.
2. SETUP     — the situation / tension in 1–3 short lines.
3. PAYLOAD   — ONE idea: the story, the failure, the lesson. Never two.
4. TAKEAWAY  — the reusable nugget the reader keeps.
5. CTA       — exactly one action (reply prompt, follow, or soft link-in-comments).
```
**Rule of one:** one point, one CTA. If you have two ideas, that's two posts.

## Formatting rules

### LinkedIn
- **Line 1 is 80% of the work** — it's all that shows before "…see more." Line 2 should widen the curiosity gap, not resolve it.
- Short paragraphs (1–2 lines). Lots of white space. No walls of text.
- **No links in the body** (the feed suppresses them) — put links in the **first comment**.
- Optional skimmable list (→ or numbers) in the payload.
- End with a question or a follow-for-next line.
- 3–5 relevant hashtags + your series tag (`#PromptToArchitecture`).

### X
- The **hook tweet must earn the expand/scroll** — no setup throat-clearing.
- **One idea per tweet.** Threads = hook → beats → artifact → recap+CTA.
- Show the artifact: code, terminal, gif, screen recording.
- Links go in a **reply**, not the hook tweet.

## Hook formulas (tuned to this series)
- **Villain:** "I gave an AI one prompt to [task]. It failed in a way I didn't expect."
- **Contrarian:** "Everyone [common practice]. Here's why I deliberately didn't."
- **Result/number:** "3 weeks in. 30 lines of code. Here's what my agent still *can't* do."
- **Curiosity gap:** "My AI agent embarrassed me this week. Here's the comment it wrote. 👇"
- **Before/after:** "Last week it sounded like a robot. This week it sounds like me. The diff:"

---

## Templates (copy, fill the [BRACKETS])

### 1. Flagship — LinkedIn
```
[HOOK: the before→after or the failure→fix of this episode, one line.]

[SETUP: where the agent was last episode, and the problem that left.]

So this week I added [the new layer].

Here's what changed:
→ Before: [the visible failure]
→ After: [the improvement]

[The one lesson this taught — generalizable beyond this project.]

The catch: [the NEW problem this created — your next episode's villain].

Episode [N+1] drops next week — I'm tackling [tease]. Follow along if you're
into building agents the honest way: one layer at a time.

#PromptToArchitecture #AIAgents #BuildInPublic
```

### 1b. Flagship — X thread
```
[HOOK TWEET: failure→fix in one line. Add: "🧵"]

1/ Last episode my agent could [do X] but [the problem].

2/ The naive fix everyone reaches for: [the over-engineered option].
   I didn't do that.

3/ Instead I added [the minimal layer]. ~[N] lines.

4/ [artifact: screen recording / code diff / before-after screenshots]

5/ The lesson: [generalizable principle].

6/ But now it's broken in a new way: [next villain].
   That's Episode [N+1].

Follow to watch 30 lines become a real system → [@you]
```

### 2. The Villain (failure post)
```
[HOOK: "My agent did [embarrassing/wrong thing] today."]

I asked it to [task]. Here's what it gave me:

[the bad output — screenshot or quote]

The problem isn't the model. It's that I [the missing layer/context].

This is exactly why you don't trust a one-shot prompt with [the job].

Fixing it next. What would *you* add first? 👇
```

### 3. The Decision (anti-hype authority)
```
[HOOK: "Everyone would add [framework/RAG/vector DB] here. I didn't."]

Here's the test I used instead:

→ Does the current layer *visibly* fail without it? [No.]
→ Will adding it make the failure I have right now go away? [No.]

So it stays out — until it earns its place.

Adding complexity you can't yet justify isn't architecture. It's decoration.

[soft CTA / question]
```

### 4. The Principle (quotable)
```
[ONE-LINE PRINCIPLE stated as a claim.]

[2–4 lines unpacking it with the concrete example from this week's build.]

[Restate it as the takeaway.]
```

### 5. The Poll (LinkedIn)
```
[HOOK: a real fork you're facing in the build, framed as a question.]

[1–2 lines of context on why it's a genuine trade-off.]

Curious how you'd call it 👇
Poll: [Option A] / [Option B] / [Option C] / It depends (comment)
```
*(The winning answer seeds next week's episode — and the comments are free research.)*

### 6. The Artifact (X-native)
```
[HOOK: "Watch my agent [do the thing]. [N] lines of code."]

[screen recording / gif / code screenshot]

[1 line on what's actually happening + 1 line tease of the limit.]
```

---

## Fully worked example — Episode 1 flagship

### LinkedIn
```
I gave an AI a single prompt to grow my LinkedIn. It wrote a perfectly
competent comment — and that's exactly the problem.

This week I started building Linkrowth: an agent that helps me engage on
LinkedIn the way that actually builds authority. Episode 1 is deliberately
dumb — 30 lines, one prompt, no frameworks.

Here's what it does:
→ I paste a post.
→ It suggests a comment + a one-line reason why.

And here's what it produced: a clean, generic, instantly-forgettable
"great breakdown, totally agree" — the kind of comment no recruiter ever
stops on.

The lesson: a one-shot prompt has no idea who you are or whether the post
was even worth engaging. Competence isn't the goal. Being *seen* is.

The catch this creates: it sounds like everyone. So Episode 2, I'm giving
it my voice. Follow along — I'm building this one honest layer at a time.

#PromptToArchitecture #AIAgents #BuildInPublic
```

### X (thread)
```
I gave an AI one prompt to grow my LinkedIn.
It wrote a flawless, forgettable comment. That's the whole problem. 🧵

1/ Meet Linkrowth — an agent that helps me engage on LinkedIn to build
   authority. Episode 1 is on purpose the dumbest version: 30 lines, one
   prompt, zero frameworks.

2/ What it does: paste a post → it suggests a comment + why.

3/ [screen recording of the CLI running]

4/ What it wrote: "Great breakdown, totally agree!" 💀
   Competent. Generic. Invisible.

5/ Lesson: a one-shot prompt doesn't know who you are or whether the post
   was even worth your time. Being competent ≠ being seen.

6/ Next episode: I give it my voice. Then: it learns which posts to skip.

Follow to watch 30 lines turn into a real system → [@you]
```
```
