import {
  buildCommenterSection,
  buildGuardrailsSection,
  buildSubstanceSection,
  buildVoiceSection,
} from "../core/prompt";
import type { UserContext } from "../core/types";
import type { AnalysisArtifact, DraftArtifact, PostCategory, SuggestedLength } from "./types";
import type { Step, StepResult } from "./types";
import type { EngageState, StepDeps } from "./types";
import { answerableQuestions } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * One playbook per category — the Analyzer has already classified the post,
 * so only the matching playbook is injected. No in-prompt routing/re-classification.
 */
const PLAYBOOKS: Record<PostCategory, string> = {
  technical: `PLAYBOOK — TECHNICAL / DEEP-DIVE POST
Analyze the technology mechanically. Do NOT invent personal work history, fake metrics, or past employers (e.g., never say "When I scaled a system..."). Ground your authority in execution realities. Use framing like "A frequent edge case here is..." or "From an architectural standpoint, the trade-off usually shifts to..."`,

  achievement: `PLAYBOOK — ACHIEVEMENT / MILESTONE POST
Acknowledge the win concisely without being overly sycophantic. Do not use excessive exclamation points. Then either name a specific, non-obvious thing that makes the milestone impressive, or — if it adds genuine value — ask one high-level, forward-looking question. Do not ask a question just to fill the slot.`,

  informal: `PLAYBOOK — INFORMAL / CULTURE / OPINION POST
Validate the human element or core observation, then tie it back to the realities of being a technical professional without being pedantic. Keep it conversational and grounded.`,
};

const LENGTH_GUIDANCE: Record<SuggestedLength, string> = {
  short: "1-2 sentences",
  standard: "2-3 sentences",
  extended: "3-4 sentences",
};

function buildTradeoffsSection(analysis: AnalysisArtifact): string {
  if (analysis.unspokenTradeoffs.length > 0) {
    return `Trade-offs you may weave in naturally (pick at most one — do not list them all):\n${analysis.unspokenTradeoffs
      .map((item) => `- ${item}`)
      .join("\n")}`;
  }

  if (analysis.category === "technical") {
    return "No unspoken trade-off was found bridging this post to the user's niche — do not force one. Lean fully on the strategic angle below instead.";
  }

  return "";
}

function buildRiskSection(analysis: AnalysisArtifact): string | null {
  if (analysis.riskFlags.length === 0) return null;
  return `SENSITIVE TOPICS PRESENT: ${analysis.riskFlags.join(", ")}. Handle these with care and appropriate tact — use your judgment on what tone is safe here.`;
}

function buildQuestionSection(analysis: AnalysisArtifact): string | null {
  const toAnswer = answerableQuestions(analysis);
  if (toAnswer.length === 0) return null;

  const listed = toAnswer.map((q) => `- "${q.text}"`).join("\n");
  const plural = toAnswer.length > 1;

  return `The author asked readers the following question${plural ? "s" : ""} (classified as worth answering):\n${listed}\nYour comment must directly answer or meaningfully reframe ${plural ? "these questions in one coherent reply — do not write a Q&A list" : "this question"}.`;
}

function buildStrategySection(analysis: AnalysisArtifact): string {
  return `Your comment must execute this strategic angle:
- Acknowledged point: "${analysis.pivotStrategy.acknowledgedPoint}"
- Insight direction (mandatory): "${analysis.pivotStrategy.insightDirection}"
  (CRITICAL INSTRUCTION: This is a command telling you WHAT argument to make — not final comment prose. Turn it into natural comment voice that matches the playbook, length, and calibration above. Do NOT invent a different angle. Do NOT copy the command wording verbatim.)`;
}

function buildCalibrationSection(analysis: AnalysisArtifact): string {
  const { authorProfile, tone, responseParameters } = analysis;

  return `CALIBRATION:
- Author: a "${authorProfile.seniority}" ${authorProfile.isTechnical ? "technical" : "non-technical"} professional, writing in a "${tone}" register — calibrate your acknowledgment to that emotional register without breaking the guardrails below.
- Length: exactly ${LENGTH_GUIDANCE[responseParameters.suggestedLength]}.
- Vocabulary: ${
    responseParameters.technicalDepth === "high"
      ? "use precise, low-level engineering terminology confidently."
      : "discuss this at a business/operational level — no code-level jargon, even if the topic is technical."
  }`;
}

function buildSystemPrompt(analysis: AnalysisArtifact, context?: UserContext): string {
  const commenterSection = context ? buildCommenterSection(context) : null;
  const voiceSection = context ? buildVoiceSection(context) : null;
  const substanceSection = context ? buildSubstanceSection(context) : null;
  const guardrailsSection = context ? buildGuardrailsSection(context) : null;
  const tradeoffsSection = buildTradeoffsSection(analysis);

  const sections = [
    `You are the "Drafter" node in an AI comment-drafting workflow. Write a single LinkedIn comment reply to the post below.

Your primary goal is to avoid generic agreeableness. Reflect the analyzer's insight direction into natural comment prose that signals real expertise — never invent a different angle, and never just validate.`,

    commenterSection ? `### COMMENTER IDENTITY\n${commenterSection}` : null,

    `### PLAYBOOK\n${PLAYBOOKS[analysis.category]}`,

    buildCalibrationSection(analysis),

    tradeoffsSection ? `### UNSPOKEN TRADE-OFFS\n${tradeoffsSection}` : null,

    `### STRATEGIC ANGLE\n${buildStrategySection(analysis)}`,

    buildQuestionSection(analysis),

    buildRiskSection(analysis),

    `### CRITICAL GUARDRAILS (THE ANTI-AI FILTER)
- NEVER start with generic praise ("Insightful share," "Great breakdown," "I completely agree," "Congratulations!").
- Enter the conversation at a peer level immediately.
- Do not use generic AI buzzwords or emojis unless explicitly instructed in the voice calibration.
- Do NOT default to ending every comment with a question. Never tack on a generic question ("What's your take?", "How are you approaching this?") just to manufacture engagement. If a question doesn't add real value, end on a confident statement instead.
- Obey every item in AVOID below in the Suggestion text. These come from the commenter's style profile and are non-negotiable.`,

    guardrailsSection ? `### AVOID\n${guardrailsSection}` : null,

    substanceSection ? `### CONTEXT\n${substanceSection}` : null,

    voiceSection ? `### VOICE CALIBRATION\nMatch this voice precisely. Do not sound like a generic assistant.\n${voiceSection}` : null,

    `### OUTPUT FORMAT
Respond in exactly this format. Do not skip either section.

**Suggestion:**
[The single-draft LinkedIn comment applying the playbook and strategic angle above.]

**Why:**
[One sentence explaining how this specific angle builds authority and connections.]`,
  ];

  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}

function buildUserMessage(state: EngageState): string {
  const headline = state.post.author?.headline?.trim();
  const authorLine = headline
    ? `Author headline: ${headline}`
    : "Author headline: (not available)";

  return `${authorLine}\n\nPost:\n${state.post.text}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseDraft(raw: string): DraftArtifact {
  const cleaned = raw
    .replace(/^```(?:markdown)?\n/i, "")
    .replace(/\n```$/, "")
    .trim();

  const suggestionMatch = cleaned.match(/\*\*Suggestion:\*\*\s*\n?([\s\S]*?)(?=\n+\*\*Why:\*\*)/i);
  const rationaleMatch = cleaned.match(/\*\*Why:\*\*\s*\n?([\s\S]+)$/i);

  if (!suggestionMatch) {
    throw new Error(
      'Could not parse drafter response — missing the required "**Suggestion:**" marker.'
    );
  }

  return {
    suggestion: suggestionMatch[1].trim(),
    rationale: rationaleMatch?.[1]?.trim(),
  };
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const drafterStep: Step = {
  name: "draft",

  async run(state: EngageState, deps: StepDeps): Promise<StepResult> {
    if (!state.analysis) {
      throw new Error("drafter step requires state.analysis from a prior analyze step");
    }

    const raw = await deps.call({
      system: buildSystemPrompt(state.analysis, state.context),
      user: buildUserMessage(state),
      maxTokens: 400,
    });

    const draft = parseDraft(raw);

    console.log(
      "\n========== DRAFTER OUTPUT ==========\n" +
        JSON.stringify(
          {
            category: state.analysis.category,
            pivotStrategy: state.analysis.pivotStrategy,
            suggestedLength: state.analysis.responseParameters.suggestedLength,
            technicalDepth: state.analysis.responseParameters.technicalDepth,
            draft,
          },
          null,
          2,
        ) +
        "\n====================================\n",
    );

    return {
      patch: { draft },
      record: {
        name: "draft",
        status: "completed",
        summary: draft.suggestion.slice(0, 100),
        output: draft,
      },
    };
  },
};
