import type { LlmPrompt, Post, UserContext } from "./types";

function hasItems(items?: string[]): items is string[] {
  return Boolean(items?.length);
}

function formatBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildCommenterSection(context: UserContext): string {
  const lines = [
    "The commenter:",
    `- Niche: ${context.niche}`,
    `- Positioning: ${context.positioning}`,
    `- Target audience: ${context.targetAudience}`,
  ];

  if (context.background?.trim()) {
    lines.push(`- Background: ${context.background.trim()}`);
  }

  return lines.join("\n");
}

function buildSubstanceSection(context: UserContext): string | null {
  const sections: string[] = [];

  if (hasItems(context.proofPoints)) {
    sections.push(`Proof points you can draw on:\n${formatBulletList(context.proofPoints)}`);
  }

  if (hasItems(context.opinions)) {
    sections.push(`Opinions this person holds:\n${formatBulletList(context.opinions)}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

function buildGuardrailsSection(context: UserContext): string | null {
  if (!hasItems(context.avoid)) {
    return null;
  }

  return `Never use these phrases or patterns:\n${formatBulletList(context.avoid)}`;
}

function buildVoiceSection(context: UserContext): string | null {
  const sections: string[] = [];

  if (hasItems(context.voiceSamples)) {
    const samples = context.voiceSamples
      .map((sample, index) => `${index + 1}. ${sample}`)
      .join("\n");

    sections.push(
      `Examples of how this person writes (mirror tone and cadence, do not copy content):\n${samples}`
    );
  }

  if (context.voiceNotes?.trim()) {
    sections.push(`Voice notes: ${context.voiceNotes.trim()}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

function buildRubric(hasVoiceContext: boolean): string {
  const items = [
    "Demonstrates genuine technical insight",
    "Substantive enough that a skimming recruiter or client stops on it",
    "Signals domain expertise without being salesy",
    "Adds to the conversation (a reply-worthy statement counts — a question is optional, not required)",
  ];

  if (hasVoiceContext) {
    items.push("Sounds like the voice samples and notes — not a generic AI or LinkedIn influencer");
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function buildEngagePrompt(post: Post, context: UserContext): LlmPrompt {
  const authorLine = post.author?.name
    ? `Author: ${post.author.name}${post.author.role ? ` (${post.author.role})` : ""}`
    : "";

  const voiceSection = buildVoiceSection(context);
  const substanceSection = buildSubstanceSection(context);

  const systemSections = [
    `You are a technical professional writing a LinkedIn comment to build authority and foster connections with peers, founders, and recruiters.

Your primary goal is to avoid generic agreeableness. You must signal real expertise, understand the context of the post, and add distinct value to the conversation.

Ending with a question is one tool for sparking dialogue — not a requirement. A sharp observation, a concrete data point, or a contrarian-but-grounded take can earn a reply on its own. Only ask a question when it is genuinely useful and would feel natural coming from a peer. A confident statement is often stronger than a forced question.`,

    `### IN-PROMPT ROUTING: THE THREE PLAYBOOKS
Before drafting the comment, you must classify the post into one of three categories and strictly apply its corresponding playbook:

1. THE TECHNICAL / DEEP-DIVE POST
* **Definition:** Posts discussing system architecture, code, AI workflows, market dynamics, or engineering trade-offs.
* **Playbook (First Principles & Passive Observer):** Analyze the technology mechanically. Do NOT invent personal work history, fake metrics, or past employers (e.g., never say "When I scaled a system..."). Ground your authority in execution realities. Use framing like "A frequent edge case here is..." or "From an architectural standpoint, the trade-off usually shifts to..."

2. THE ACHIEVEMENT / MILESTONE POST
* **Definition:** Posts sharing a new job, certification, product launch, or team milestone.
* **Playbook (Peer Recognition + Future Horizon):** Acknowledge the win concisely without being overly sycophantic. Do not use excessive exclamation points. Then either name a specific, non-obvious thing that makes the milestone impressive, or — if it adds genuine value — ask one high-level, forward-looking question. Do not ask a question just to fill the slot. (Question example: "Huge milestone. I'm curious, what was the biggest technical hurdle your team had to bypass to get this shipped?" Statement example: "Huge milestone. Shipping multi-region failover with a team this lean is the part most people underestimate.")

3. THE INFORMAL / CULTURE / OPINION POST
* **Definition:** Posts about remote work, industry culture, productivity, or non-technical observations.
* **Playbook (Shared Reality + Constructive Build):** Validate the human element or core observation, then tie it back to the realities of being a technical professional without being pedantic. Keep it conversational and grounded.`,

    `### CRITICAL GUARDRAILS (THE ANTI-AI FILTER)
* NEVER start with generic praise ("Insightful share," "Great breakdown," "I completely agree," "Congratulations!").
* Enter the conversation at a peer level immediately.
* Do not use generic AI buzzwords or emojis unless explicitly instructed in the voice calibration.
* Do NOT default to ending every comment with a question. Never tack on a generic question ("What's your take?", "How are you approaching this?") just to manufacture engagement. If a question doesn't add real value, end on a confident statement instead.
* Max length: 3-4 sentences.`,

    substanceSection 
      ? `### CONTEXT:\n${substanceSection}` 
      : null,

    voiceSection
      ? `### VOICE CALIBRATION:\nMatch this voice precisely. Do not sound like a generic assistant.\n${voiceSection}`
      : null,

    `### EXECUTION FORMAT
You must respond in exactly this valid Markdown format. Do not skip any section.

### 1. Post Classification & Analysis
* **Category:** [Choose exactly one: Technical, Achievement, or Informal]
* **Core Subject:** [1 sentence summarizing what the post is actually about]

### 2. Playbook Selection & Strategy
* **Applied Playbook:** [State the playbook rules you are applying]
* **Value Hook:** [State the single strongest angle — a technical nuance, a specific point of recognition, or a shared reality. Then note whether you will close with a question or a statement, and why a question is or isn't warranted here.]

### 3. Voice Calibration
* **Voice Check:** [Identify 2 specific rules from the provided voice profile that apply here]

### 4. Final Output
**Suggestion:**
[The single-draft LinkedIn comment applying the playbook. Max 3-4 sentences.]

**Why:**
[One sentence explaining how this specific angle builds authority and connections.]`
  ].filter((section): section is string => Boolean(section));

  return {
    system: systemSections.join("\n\n"),
    user: [authorLine, post.text].filter(Boolean).join("\n\n"),
  };
}
