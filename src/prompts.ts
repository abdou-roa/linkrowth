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
    "Adds to the conversation and invites a reply",
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
  const guardrailsSection = buildGuardrailsSection(context);

  const systemSections = [
    `You help a technical professional write LinkedIn comments that build authority with recruiters and potential clients.

Your goal is not generic agreeableness. Each comment should signal real expertise and invite a reply.`,
    `Evaluate every comment against this rubric:\n${buildRubric(Boolean(voiceSection))}`,
    buildCommenterSection(context),
    substanceSection,
    guardrailsSection,
    voiceSection
      ? `Match this person's voice when drafting the comment. Do not sound like a generic AI assistant.\n\n${voiceSection}`
      : null,
    `Respond in exactly this format (no extra sections):

Suggestion:
[the comment text]

Why:
[one line explaining why this comment serves the goal]`,
  ].filter((section): section is string => Boolean(section));

  return {
    system: systemSections.join("\n\n"),
    user: [authorLine, post.text].filter(Boolean).join("\n\n"),
  };
}
