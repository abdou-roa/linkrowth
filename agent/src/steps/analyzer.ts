import type { AnalysisArtifact, AuthorSeniority, PostTone } from "./types";
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

TONE RULES:
- Identify the author's emotional register: "celebratory", "reflective", "frustrated", "analytical", "provocative", or "neutral".
- Base this only on the post's own language (exclamation points, hedging, complaints, bragging, calm explanation, etc.), not on the category.

AUTHOR PROFILE RULES:
- Use only the author's LinkedIn headline (provided in the user message) to set authorProfile fields — never infer these from the post body.
- "isTechnical": true when the headline indicates an engineering, product-engineering, data/ML, or other hands-on technical role. false for founders/execs without a technical signal, recruiters, marketers, sales, HR, coaches, or when the headline is missing/ambiguous.
- "seniority": "founder" for founder/co-founder/CEO titles, "leadership" for VP/Director/Head-of/Manager titles, "ic" for individual-contributor titles (engineer, designer, analyst, specialist, etc.), "unknown" when the headline is missing or ambiguous.

DIRECT QUESTION RULES:
- Set "postQuestion" to the exact (or lightly paraphrased) question if the post explicitly asks readers a direct question.
- Set it to null if the post makes no direct ask of its readers.

UNSPOKEN TRADE-OFFS RULES:
- Only populate this array when category is "technical".
- For achievement or informal posts, set it to an empty array [].
- Each entry must be directly implied by a specific technology, pattern, decision, or claim the author explicitly named in the post.
- Do NOT invent generic trade-offs unrelated to what the author wrote.
- Limit to 1–2 entries. Be specific and grounded, not broad.

RISK FLAG RULES:
- Flag sensitive topics that require careful handling in "riskFlags": e.g. "layoffs", "personal-loss", "competitor-criticism", "political", "controversial-opinion".
- Set it to an empty array [] when the post is safe, ordinary professional content.

PIVOT STRATEGY RULES:
- "acknowledgedPoint": the single strongest claim or detail from the post worth referencing — be specific, not generic.
- "insightToInject": a technical nuance, operational reality, or honest counter-angle that adds value to the conversation. For achievement posts this can be a non-obvious dimension of the milestone. For informal posts it can be a grounding observation tied to professional reality.
- If "postQuestion" is set, "insightToInject" should directly answer or meaningfully reframe that question rather than ignoring it.

OUTPUT FORMAT:
Return only the JSON object. No markdown fences, no explanation.

{
  "category": "technical | achievement | informal",
  "coreThesis": "<1–2 sentence summary of the author's main point>",
  "tone": "celebratory | reflective | frustrated | analytical | provocative | neutral",
  "authorProfile": {
    "isTechnical": true,
    "seniority": "ic | leadership | founder | unknown"
  },
  "postQuestion": "<exact or paraphrased question, or null>",
  "unspokenTradeoffs": [
    "<direct implication of something the author explicitly named>"
  ],
  "riskFlags": [
    "<sensitive topic to handle carefully>"
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

const VALID_TONES: PostTone[] = [
  "celebratory",
  "reflective",
  "frustrated",
  "analytical",
  "provocative",
  "neutral",
];

const VALID_SENIORITIES: AuthorSeniority[] = ["ic", "leadership", "founder", "unknown"];

function parseAnalysis(raw: string): AnalysisArtifact {
  const json = extractJson(raw);
  const parsed = JSON.parse(json) as AnalysisArtifact;

  // Normalise: guarantee array fields are always arrays
  if (!Array.isArray(parsed.unspokenTradeoffs)) {
    parsed.unspokenTradeoffs = [];
  }
  if (!Array.isArray(parsed.riskFlags)) {
    parsed.riskFlags = [];
  }

  // Normalise: coerce authorProfile fields to known shapes
  parsed.authorProfile = {
    isTechnical: Boolean(parsed.authorProfile?.isTechnical),
    seniority: VALID_SENIORITIES.includes(parsed.authorProfile?.seniority as AuthorSeniority)
      ? (parsed.authorProfile.seniority as AuthorSeniority)
      : "unknown",
  };

  // Normalise: fall back to "neutral" for unrecognised/missing tone
  parsed.tone = VALID_TONES.includes(parsed.tone) ? parsed.tone : "neutral";

  // Normalise: guarantee postQuestion is either a non-empty string or null
  parsed.postQuestion =
    typeof parsed.postQuestion === "string" && parsed.postQuestion.trim()
      ? parsed.postQuestion.trim()
      : null;

  return parsed;
}

// NOTE: Post.comments isn't populated yet — the extension can't fetch existing
// comments off a post. Once it can, revive an "existing discourse" section here
// (and a corresponding alreadyCovered field in AnalysisArtifact) so the analyzer
// can steer the pivot strategy away from angles already taken.
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
      maxTokens: 768,
    });

    const analysis = parseAnalysis(raw);

    console.log(
      "\n========== ANALYZER OUTPUT ==========\n" +
        JSON.stringify(analysis, null, 2) +
        "\n=====================================\n",
    );

    return {
      patch: { analysis },
      record: {
        name: "analyze",
        status: "completed",
        summary: `${analysis.category} · ${analysis.tone} · ${analysis.authorProfile.isTechnical ? "technical author" : "non-technical author"} · ${analysis.coreThesis.slice(0, 80)}`,
        output: analysis,
      },
    };
  },
};
