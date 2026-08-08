import {
  buildCommenterSection,
  buildGuardrailsSection,
  buildSubstanceSection,
  buildVoiceSection,
} from "../core/prompt";
import type { UserContext } from "../core/types";
import type {
  AnalysisArtifact,
  CritiqueFinding,
  DraftArtifact,
  DraftAttempt,
  PostCategory,
  SuggestedLength,
} from "./types";
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
Analyze the technology mechanically. Ground your authority in execution realities. 
- If the post asks a technical question, answer it directly with realistic operational trade-offs ("In production, the primary friction point usually becomes...").
- Do NOT invent personal work history or fake metrics (never say "When I scaled a system...").`,

  achievement: `PLAYBOOK — ACHIEVEMENT / MILESTONE POST
Acknowledge the win concisely without being sycophantic or using excessive exclamation points.
- If the author asks a question about their milestone/next steps, answer it concisely.
- Otherwise, highlight a non-obvious aspect that makes the milestone impressive or ask one high-level, forward-looking peer question.`,

  informal: `PLAYBOOK — INFORMAL / CULTURE / OPINION POST
- If a question is asked, respond directly as a peer sharing practical industry perspective.
- Validate the human element or core observation, keeping it conversational, grounded, and non-pedantic.`,
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
    return "No unspoken trade-off was found bridging this post to the user's niche — do not force one. Lean fully on answering the question or executing the strategic angle below.";
  }

  return "";
}

function buildRiskSection(analysis: AnalysisArtifact): string | null {
  if (analysis.riskFlags.length === 0) return null;
  return `SENSITIVE TOPICS PRESENT: ${analysis.riskFlags.join(", ")}. Handle these with care and appropriate tact — use your judgment on what tone is safe here.`;
}

/**
 * Unified Strategy & Interaction Section
 * Combines Core Thesis, Acknowledged Point, Extracted Questions, and Strategic Direction.
 */
function buildStrategySection(analysis: AnalysisArtifact): string {
  const toAnswer = answerableQuestions(analysis);
  const questionsPresent = toAnswer.length > 0;

  const lines: string[] = [];

  if (analysis.coreThesis) {
    lines.push(`- Author's Core Thesis: "${analysis.coreThesis}"`);
  }

  lines.push(`- Specific Detail to Reference: "${analysis.pivotStrategy.acknowledgedPoint}"`);

  if (questionsPresent) {
    const formattedQuestions = toAnswer.map((q) => `"${q.text}"`).join("; ");
    lines.push(`- Author's Question(s) to Answer: ${formattedQuestions}`);
    lines.push(
      `- MANDATORY INTERACTION: Your draft MUST directly answer or reframe the author's question(s). Do NOT ignore the question.`
    );
  }

  lines.push(
    `- Insight Direction (How to answer/pivot): "${analysis.pivotStrategy.insightDirection}"`
  );
  lines.push(
    `  (INSTRUCTION: Execute this direction into natural comment prose. Do NOT copy command wording verbatim or sound like an assistant answering a prompt.)`
  );

  return lines.join("\n");
}

function buildCalibrationSection(analysis: AnalysisArtifact): string {
  const { authorProfile, tone, responseParameters } = analysis;

  return `CALIBRATION:
- Author: a "${authorProfile.seniority}" ${authorProfile.isTechnical ? "technical" : "non-technical"} professional, writing in a "${tone}" register — calibrate your tone to match this register naturally.
- Length: exactly ${LENGTH_GUIDANCE[responseParameters.suggestedLength]}.
- Vocabulary: ${
    responseParameters.technicalDepth === "high"
      ? "use precise, low-level engineering terminology confidently."
      : "discuss this at a business/operational level — no code-level jargon, even if the topic is technical."
  }`;
}

function formatFinding(finding: CritiqueFinding): string {
  const excerpt = finding.excerpt?.trim()
    ? ` on "${finding.excerpt.trim()}" →`
    : "";
  return `- [${finding.dimension}]${excerpt} ${finding.instruction}`;
}

/**
 * Injected only on redraft cycles. The rejected draft stays visible so the
 * model can avoid repeating the same wording; findings are directives, not
 * soft suggestions.
 */
function buildFeedbackSection(history: DraftAttempt[]): string | null {
  if (history.length === 0) return null;

  const blocks = history.map((attempt) => {
    const findings =
      attempt.findings.length > 0
        ? attempt.findings.map(formatFinding).join("\n")
        : "- (no structured findings recorded — still produce a tighter rewrite)";

    return `Attempt ${attempt.attempt} — rejected draft:
"""
${attempt.draft.suggestion}
"""

Findings to fix:
${findings}`;
  });

  return `### REVISION REQUIRED
A prior draft was rejected by the Refiner. Rewrite the comment so every finding below is resolved.

Rules for the rewrite:
- Treat each finding's instruction as mandatory.
- Where an excerpt is quoted, that span (or its meaning) must not reappear in the same form.
- Keep the strategic angle, the acknowledged point, and any answered questions unless a finding explicitly requires changing them.
- Do not introduce new first-person claims of employers, metrics, or past projects that are not supported by COMMENTER IDENTITY / CONTEXT.
- Return a full new comment, not a diff or commentary on the old one.

${blocks.join("\n\n")}`;
}

function buildSystemPrompt(
  analysis: AnalysisArtifact,
  context?: UserContext,
  feedbackHistory: DraftAttempt[] = [],
): string {
  const commenterSection = context ? buildCommenterSection(context) : null;
  const voiceSection = context ? buildVoiceSection(context) : null;
  const substanceSection = context ? buildSubstanceSection(context) : null;
  const guardrailsSection = context ? buildGuardrailsSection(context) : null;
  const tradeoffsSection = buildTradeoffsSection(analysis);
  const feedbackSection = buildFeedbackSection(feedbackHistory);
  const isRevision = feedbackHistory.length > 0;

  const sections = [
    `You are the "Drafter" node in an AI comment-drafting workflow. ${
      isRevision
        ? "Rewrite a LinkedIn comment reply that was rejected — fix every Refiner finding while keeping the same strategic obligations."
        : "Write a single LinkedIn comment reply to the post below."
    }

Your primary goal is to write an interactive, peer-level comment. Respond naturally to what the author wrote or asked without generic agreeableness or AI filler.`,

    commenterSection ? `### COMMENTER IDENTITY\n${commenterSection}` : null,

    `### PLAYBOOK\n${PLAYBOOKS[analysis.category]}`,

    buildCalibrationSection(analysis),

    tradeoffsSection ? `### UNSPOKEN TRADE-OFFS\n${tradeoffsSection}` : null,

    `### STRATEGIC ANGLE & INTERACTION\n${buildStrategySection(analysis)}`,

    buildRiskSection(analysis),

    `### CRITICAL GUARDRAILS (THE ANTI-AI FILTER)
- NEVER start with generic praise ("Insightful share," "Great breakdown," "I completely agree," "Congratulations!").
- Enter the conversation at a peer level immediately.
- If the post asks a question, answer it directly. Do NOT default to asking a counter-question unless it naturally deepens the discussion.
- Never tack on a generic ending question ("What's your take?", "How are you approaching this?") just to manufacture engagement.
- Obey every item in AVOID below in the Suggestion text.`,

    guardrailsSection ? `### AVOID\n${guardrailsSection}` : null,

    substanceSection ? `### CONTEXT\n${substanceSection}` : null,

    voiceSection ? `### VOICE CALIBRATION\nMatch this voice precisely. Do not sound like a generic assistant.\n${voiceSection}` : null,

    feedbackSection,

    `### OUTPUT FORMAT
Respond in exactly this format. Do not skip either section.

**Suggestion:**
[The single-draft LinkedIn comment applying the playbook and strategic angle above${
      isRevision ? ", with every Refiner finding resolved" : ""
    }.]

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

    const isRevision = state.feedbackHistory.length > 0;

    const raw = await deps.call({
      system: buildSystemPrompt(state.analysis, state.context, state.feedbackHistory),
      user: buildUserMessage(state),
      maxTokens: 400,
    });

    const draft = parseDraft(raw);

    console.log(
      "\n========== DRAFTER OUTPUT ==========\n" +
        JSON.stringify(
          {
            attempt: state.attempts,
            revision: isRevision,
            feedbackCount: state.feedbackHistory.length,
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
        summary: isRevision
          ? `redraft #${state.attempts} · ${draft.suggestion.slice(0, 80)}`
          : draft.suggestion.slice(0, 100),
        output: draft,
      },
    };
  },
};
