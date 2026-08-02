import type { AnalysisArtifact } from "./types";
import type { Step, StepResult } from "./types";
import type { EngageState, StepDeps } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the "Post Analyzer" node in an AI comment-drafting workflow.
Your only job is structural analysis — you do NOT write a comment draft.

Analyze the post and return a single JSON object. Follow these rules strictly:

CATEGORY RULES:
- "technical": post discusses system architecture, code, AI/ML, engineering trade-offs, tools, or market dynamics at a technical level.
- "achievement": post announces a new role, product launch, certification, funding, or team milestone.
- "informal": opinion, culture, productivity, remote work, or anything that doesn't fit the above.

AUTHOR PROFILE RULES:
- Use only the author's LinkedIn headline (provided in the user message) to set authorProfile.isTechnical.
- true when the headline indicates an engineering, product-engineering, data/ML, or other hands-on technical role.
- false for founders/execs without a technical signal, recruiters, marketers, sales, HR, coaches, or when the headline is missing/ambiguous.
- Do NOT infer technical depth from the post body alone for this field — the headline is the signal.

UNSPOKEN TRADE-OFFS RULES:
- Only populate this array when category is "technical".
- For achievement or informal posts, set it to an empty array [].
- Each entry must be directly implied by a specific technology, pattern, decision, or claim the author explicitly named in the post.
- Do NOT invent generic trade-offs unrelated to what the author wrote.
- Limit to 1–2 entries. Be specific and grounded, not broad.

PIVOT STRATEGY RULES:
- "acknowledgedPoint": the single strongest claim or detail from the post worth referencing — be specific, not generic.
- "insightToInject": a technical nuance, operational reality, or honest counter-angle that adds value to the conversation. For achievement posts this can be a non-obvious dimension of the milestone. For informal posts it can be a grounding observation tied to professional reality.

OUTPUT FORMAT:
Return only the JSON object. No markdown fences, no explanation.

{
  "category": "technical | achievement | informal",
  "coreThesis": "<1–2 sentence summary of the author's main point>",
  "authorProfile": {
    "isTechnical": true
  },
  "unspokenTradeoffs": [
    "<direct implication of something the author explicitly named>"
  ],
  "pivotStrategy": {
    "acknowledgedPoint": "<specific claim or detail from the post>",
    "insightToInject": "<the angle that adds genuine value>"
  }
}`;

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJson(raw: string): string {
  // Strip markdown code fences if the model wraps the output anyway
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Find the outermost { ... } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }

  return raw.trim();
}

function parseAnalysis(raw: string): AnalysisArtifact {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as AnalysisArtifact;

  // Normalise: guarantee unspokenTradeoffs is always an array
  if (!Array.isArray(parsed.unspokenTradeoffs)) {
    parsed.unspokenTradeoffs = [];
  }

  // Normalise: coerce isTechnical to a boolean
  parsed.authorProfile = {
    isTechnical: Boolean(parsed.authorProfile?.isTechnical),
  };

  return parsed;
}

function buildUserMessage(state: EngageState): string {
  const headline = state.post.author?.headline?.trim();
  const authorLine = headline
    ? `Author headline: ${headline}`
    : "Author headline: (not available)";

  return `${authorLine}\n\nPost:\n${state.post.text}`;
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const analyzerStep: Step = {
  name: "analyze",

  async run(state: EngageState, deps: StepDeps): Promise<StepResult> {
    const raw = await deps.call({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(state),
      maxTokens: 512,
    });

    const analysis = parseAnalysis(raw);

    return {
      patch: { analysis },
      record: {
        name: "analyze",
        status: "completed",
        summary: `${analysis.category} · ${analysis.authorProfile.isTechnical ? "technical author" : "non-technical author"} · ${analysis.coreThesis.slice(0, 80)}`,
        output: analysis,
      },
    };
  },
};
