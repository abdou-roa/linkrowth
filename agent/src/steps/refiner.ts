import { extractJsonBlock } from "../core/parse";
import { buildVoiceSection, formatBulletList, hasItems } from "../core/prompt";
import type { UserContext } from "../core/types";
import type {
  AnalysisArtifact,
  CritiqueArtifact,
  CritiqueFinding,
  DraftArtifact,
  FindingDimension,
  SuggestedLength,
} from "./types";
import type { Step, StepResult } from "./types";
import type { EngageState, StepDeps } from "./types";

// ---------------------------------------------------------------------------
// Deterministic length check
//
// Length is measured in code rather than asked of the model: models count
// badly, and this is the one mechanical violation that can't be auto-repaired
// without rewriting the comment.
// ---------------------------------------------------------------------------

const MAX_SENTENCES: Record<SuggestedLength, number> = {
  short: 2,
  standard: 3,
  extended: 4,
};

/** Sentence splitting is approximate (abbreviations inflate it), so only a clear overshoot counts. */
const LENGTH_TOLERANCE = 1;

function countSentences(text: string): number {
  return text
    .split(/[.!?]+(?:\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function checkLength(
  draft: DraftArtifact,
  analysis: AnalysisArtifact
): CritiqueFinding | null {
  const limit = MAX_SENTENCES[analysis.responseParameters.suggestedLength];
  const count = countSentences(draft.suggestion);

  if (count <= limit + LENGTH_TOLERANCE) return null;

  // Naming what must survive the cut, because the acknowledgment and the
  // question answer are the first things a redraft tends to drop.
  const mustKeep = analysis.postQuestion
    ? "the acknowledged point, the injected insight, or the answer to the author's question"
    : "the acknowledged point or the injected insight";

  return {
    dimension: "length",
    instruction: `The draft runs ${count} sentences; a "${analysis.responseParameters.suggestedLength}" comment allows at most ${limit}. Tighten the wording to fit without dropping ${mustKeep}.`,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * The fabrication boundary. Everything the commenter can legitimately claim in
 * the first person has to be visible here, or the check produces false positives.
 */
function buildGroundingSection(context?: UserContext): string {
  if (!context) {
    return `COMMENTER GROUNDING:
(not available — treat every first-person claim of specific experience, employment, or metrics as unsupported.)`;
  }

  const lines = [`- Niche: ${context.niche}`];

  if (context.background?.trim()) {
    lines.push(`- Background: ${context.background.trim()}`);
  }

  if (hasItems(context.proofPoints)) {
    lines.push(`- Proof points they can legitimately claim:\n${formatBulletList(context.proofPoints)}`);
  } else {
    lines.push(
      "- Proof points: none recorded. They have no specific metrics or named projects to draw on beyond the background above."
    );
  }

  if (hasItems(context.opinions)) {
    lines.push(`- Positions they hold: ${context.opinions.join("; ")}`);
  }

  return `COMMENTER GROUNDING (what this person can truthfully claim as their own):\n${lines.join("\n")}`;
}

function buildAnalysisSection(analysis: AnalysisArtifact): string {
  const lines = [
    `- The post's core thesis: ${analysis.coreThesis}`,
    `- Point the draft was told to acknowledge: "${analysis.pivotStrategy.acknowledgedPoint}"`,
    `- Insight the draft was told to inject: "${analysis.pivotStrategy.insightToInject}"`,
    `- Author's register: ${analysis.tone}`,
  ];

  lines.push(
    analysis.postQuestion
      ? `- The author directly asked readers: "${analysis.postQuestion}"`
      : "- The author asked readers no direct question."
  );

  if (analysis.riskFlags.length > 0) {
    lines.push(`- Sensitive topics present: ${analysis.riskFlags.join(", ")}`);
  }

  return `WHAT THE DRAFT WAS ASKED TO DO:\n${lines.join("\n")}`;
}

function buildSystemPrompt(analysis: AnalysisArtifact, context?: UserContext): string {
  const voiceSection = context ? buildVoiceSection(context) : null;

  const sections = [
    `You are the "Refiner" node in an AI comment-drafting workflow. You review a drafted LinkedIn comment and report what is wrong with it.

You do NOT rewrite. Never return a corrected comment — only findings.

Report only concrete, defensible problems, each anchored to a span you can quote from the draft. An empty findings list is the correct answer for a good draft; never invent findings to appear thorough.`,

    `### FABRICATION — the dimension that blocks a draft
The commenter posts this under their own name, so it must never claim experience they do not have.

FLAG a span when the draft attributes to the commenter (via "I", "we", "my", "our"):
- a specific employer, client, team, or past project
- a numeric result, benchmark, or metric
- a concrete past event ("when I migrated...", "we hit this at scale")
that the COMMENTER GROUNDING below does not support.

DO NOT flag:
- general statements about how a technology, market, or process behaves, even when stated confidently and without a source. This register is deliberate — the drafter was instructed to write this way.
- first-person statements that stay inside the commenter's stated background and niche.
- opinions, predictions, or framings such as "a frequent edge case here is..." or "the trade-off usually shifts to...".

Calibration examples:
- "We cut p99 latency 40% after sharding the index." → FLAG (a metric claimed as their own)
- "At my last company we hit this exact wall." → FLAG (an unstated employer and past event)
- "Vector stores drift once write throughput outpaces reindexing." → do not flag (a general technical claim)
- "I keep running into this building agent pipelines." → do not flag when the background covers agent systems`,

    `### ADVISORY DIMENSIONS — recorded for human review, never blocking
- "strategyFidelity": the draft does not carry the insight it was told to inject, or acknowledges the post without adding anything of its own.
- "questionObligation": the author asked a direct question and the draft neither answers nor meaningfully reframes it.
- "nicheSignature": nothing in the draft could only have been written by someone in this commenter's niche — it would read identically from any commenter.
- "riskHandling": a sensitive topic is present and the draft's register is careless given that.
- "voiceMatch": cadence or register drifts from the commenter's voice samples.`,

    `### OUT OF SCOPE
Do not report anything about the comment's length or sentence count. Length is measured separately and any finding you raise about it will be discarded.`,

    buildAnalysisSection(analysis),

    buildGroundingSection(context),

    voiceSection ? `### VOICE REFERENCE\n${voiceSection}` : null,

    `### OUTPUT FORMAT
Return only a JSON object. No markdown fences, no explanation.

{
  "findings": [
    {
      "dimension": "fabrication | strategyFidelity | questionObligation | nicheSignature | riskHandling | voiceMatch",
      "excerpt": "<the exact span from the draft, copied verbatim>",
      "instruction": "<what to do about it, phrased as a directive the drafter can act on: 'drop the 40% figure', not 'this feels unsupported'>"
    }
  ]
}

Return {"findings": []} when the draft is clean.`,
  ];

  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}

function buildUserMessage(state: EngageState, draft: DraftArtifact): string {
  return `The post being replied to:\n${state.post.text}\n\nThe drafted comment under review:\n${draft.suggestion}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** "length" is excluded: the model is told not to judge it and we measure it ourselves. */
const MODEL_DIMENSIONS: FindingDimension[] = [
  "fabrication",
  "strategyFidelity",
  "questionObligation",
  "nicheSignature",
  "riskHandling",
  "voiceMatch",
];

const BLOCKING_DIMENSIONS: FindingDimension[] = ["fabrication", "length"];

function parseFindings(raw: string): CritiqueFinding[] {
  const parsed = JSON.parse(extractJsonBlock(raw)) as { findings?: unknown };

  if (!Array.isArray(parsed.findings)) return [];

  return parsed.findings.reduce<CritiqueFinding[]>((findings, entry) => {
    const candidate = entry as Partial<CritiqueFinding>;
    const dimension = candidate?.dimension as FindingDimension;
    const instruction =
      typeof candidate?.instruction === "string" ? candidate.instruction.trim() : "";

    if (!MODEL_DIMENSIONS.includes(dimension) || !instruction) {
      return findings;
    }

    const excerpt = typeof candidate.excerpt === "string" ? candidate.excerpt.trim() : "";

    findings.push({
      dimension,
      instruction,
      ...(excerpt ? { excerpt } : {}),
    });

    return findings;
  }, []);
}

function summarise(critique: CritiqueArtifact): string {
  if (critique.findings.length === 0) return "approved · no findings";

  const dimensions = [...new Set(critique.findings.map((finding) => finding.dimension))];
  return `${critique.verdict} · ${critique.findings.length} finding(s) · ${dimensions.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const refinerStep: Step = {
  name: "refine",

  async run(state: EngageState, deps: StepDeps): Promise<StepResult> {
    const { analysis, draft } = state;

    if (!analysis) {
      throw new Error("refiner step requires state.analysis from a prior analyze step");
    }
    if (!draft) {
      throw new Error("refiner step requires state.draft from a prior draft step");
    }

    const raw = await deps.call({
      system: buildSystemPrompt(analysis, state.context),
      user: buildUserMessage(state, draft),
      maxTokens: 600,
    });

    const findings = parseFindings(raw);

    const lengthFinding = checkLength(draft, analysis);
    if (lengthFinding) {
      findings.push(lengthFinding);
    }

    // The verdict is derived here rather than taken from the model, so the set
    // of blocking dimensions stays a code-level decision.
    const critique: CritiqueArtifact = {
      verdict: findings.some((finding) => BLOCKING_DIMENSIONS.includes(finding.dimension))
        ? "rejected"
        : "approved",
      findings,
    };

    const isApproved = critique.verdict === "approved";

    // Post and draft are echoed as raw text, not folded into the JSON, so the
    // findings can be judged against exactly what the model was shown.
    console.log(
      "\n========== REFINER OUTPUT ==========\n" +
        `POST:\n${state.post.text}\n\n` +
        `DRAFT UNDER REVIEW:\n${draft.suggestion}\n\n` +
        `CRITIQUE:\n${JSON.stringify(critique, null, 2)}` +
        "\n====================================\n",
    );

    return {
      patch: {
        isApproved,
        status: isApproved ? "ready_for_review" : "in_progress",
        feedbackHistory: isApproved
          ? state.feedbackHistory
          : [
              ...state.feedbackHistory,
              { attempt: state.attempts, draft, findings },
            ],
      },
      record: {
        name: "refine",
        status: "completed",
        summary: summarise(critique),
        output: critique,
      },
    };
  },
};
