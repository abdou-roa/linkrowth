import { extractJsonBlock } from "../core/parse";
import type { UserContext } from "../core/types";
import type {
  AnalysisArtifact,
  AuthorSeniority,
  PostTone,
  SuggestedLength,
  TechnicalDepth,
} from "./types";
import type { Step, StepResult } from "./types";
import type { EngageState, StepDeps } from "./types";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * The analyzer is the bridge between the post's content and the user's persona:
 * every trade-off and insight it surfaces must be filterable through the
 * user's own domain authority, not generic industry commentary.
 */
function buildUserDomainSection(context?: UserContext): string {
  if (!context) {
    return `USER DOMAIN CONTEXT:
(not available — leave "unspokenTradeoffs" empty and keep "pivotStrategy.identifiedBridge" general rather than inventing a domain fit.)`;
  }

  const lines = [`- Niche: ${context.niche}`];

  if (context.background?.trim()) {
    lines.push(`- Background: ${context.background.trim()}`);
  }

  if (context.opinions?.length) {
    lines.push(`- Opinions this person holds: ${context.opinions.join("; ")}`);
  }

  return `USER DOMAIN CONTEXT (The person who will post the eventual comment. CRITICAL: Apply this context to your analysis ONLY if the post topic naturally intersects with this niche. If unrelated, ignore this section entirely):\n${lines.join("\n")}`;
}

function buildSystemPrompt(context?: UserContext): string {
  return `You are the "Post Analyzer" node in an AI comment-drafting workflow.
Your only job is structural analysis — you do NOT write a comment draft.

${buildUserDomainSection(context)}

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
- Only populate this array when the category is "technical".
- For achievement or informal posts, set it to an empty array [].
- CRITICAL: each entry must bridge a concept explicitly named in the post to the USER DOMAIN CONTEXT above. Do not invent trade-offs outside the user's established niche.
- If the post's technical subject has no genuine bridge to the user's niche, leave this array empty rather than forcing an unrelated trade-off.
- Limit to 1–2 entries. Be specific and grounded in production reality.

RISK FLAG RULES:
- Flag sensitive topics that require careful handling in "riskFlags": e.g. "layoffs", "personal-loss", "competitor-criticism", "political", "controversial-opinion".
- Set it to an empty array [] when the post is safe, ordinary professional content.

PIVOT STRATEGY RULES:
- "acknowledgedPoint": the single strongest claim or detail from the post worth referencing — pull an exact detail (a number, a named tool, a decision, a phrase), not a summary of the post's vibe.
- "identifiedBridge": The raw conceptual link between the post and the user's domain. Do NOT write a reaction, a sentence, or a draft. Output 1-3 abstract words indicating the core engineering concept the drafter should focus on. 
  - Example (Technical): "redis-latency-limits"
  - Example (Achievement): "deterministic-system-management"
  - Example (Informal): "async-context-switching-tax"
- CRITICAL ESCAPE HATCH: If the post is entirely outside the niche stated in USER DOMAIN CONTEXT above, DO NOT force a connection to the user's domain. Instead, set "identifiedBridge" to the core technical or operational bottleneck mentioned in the post itself.

RESPONSE PARAMETERS RULES:
- "suggestedLength": mirror the actual length and weight of the post itself — judge this from the post's own word/sentence count and how much substance it contains, not from its category. "standard" is NOT the reflexive default; most posts, including most achievement posts, are short.
  - "short": the post is roughly under 3 sentences, a quick celebratory note, a one-liner opinion, or has essentially one point. This covers most informal posts and simple achievement announcements.
  - "standard": the post lays out 2+ distinct points, a specific story, or enough concrete detail that a one-liner reaction would leave value on the table.
  - "extended": ONLY when the post is a deep technical dive AND "postQuestion" is set asking for community feedback or an architectural opinion.
  - When genuinely unsure between two tiers, choose the shorter one — a comment that reads slightly terse is more human than one padded to hit a length.
- "technicalDepth":
  - "high" ONLY when category is "technical" AND authorProfile.isTechnical is true — signals the drafter to use precise, low-level engineering terminology.
  - "accessible" for founders, non-technical authors, or achievement/informal posts — signals the drafter to stick to high-level business/operational realities without code-level jargon.

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
    "<concept from the post bridged to the user's specific niche>"
  ],
  "riskFlags": [
    "<sensitive topic to handle carefully>"
  ],
  "pivotStrategy": {
    "acknowledgedPoint": "<specific claim or detail from the post>",
    "identifiedBridge": "<1-3 abstract words naming the core engineering concept>"
  },
  "responseParameters": {
    "suggestedLength": "short | standard | extended",
    "technicalDepth": "high | accessible"
  }
}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const VALID_TONES: PostTone[] = [
  "celebratory",
  "reflective",
  "frustrated",
  "analytical",
  "provocative",
  "neutral",
];

const VALID_SENIORITIES: AuthorSeniority[] = ["ic", "leadership", "founder", "unknown"];

const VALID_LENGTHS: SuggestedLength[] = ["short", "standard", "extended"];
const VALID_DEPTHS: TechnicalDepth[] = ["high", "accessible"];

function parseAnalysis(raw: string): AnalysisArtifact {
  const json = extractJsonBlock(raw);
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

  // Normalise: fall back to safe defaults for unrecognised response parameters
  const requestedLength = VALID_LENGTHS.includes(parsed.responseParameters?.suggestedLength)
    ? parsed.responseParameters.suggestedLength
    : "standard";

  // A "short" budget can't hold an acknowledgment, an injected insight, and an
  // answer to a direct question — the answer is what gets dropped. Floor it.
  const suggestedLength =
    parsed.postQuestion && requestedLength === "short" ? "standard" : requestedLength;
  const technicalDepth = VALID_DEPTHS.includes(parsed.responseParameters?.technicalDepth)
    ? parsed.responseParameters.technicalDepth
    : "accessible";

  // Enforce the deterministic gate ourselves: "high" depth requires a technical
  // category AND a technical author, regardless of what the model returned.
  parsed.responseParameters = {
    suggestedLength,
    technicalDepth:
      technicalDepth === "high" &&
      parsed.category === "technical" &&
      parsed.authorProfile.isTechnical
        ? "high"
        : "accessible",
  };

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
      system: buildSystemPrompt(state.context),
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
        summary: `${analysis.category} · ${analysis.tone} · ${analysis.authorProfile.isTechnical ? "technical author" : "non-technical author"} · ${analysis.responseParameters.suggestedLength}/${analysis.responseParameters.technicalDepth} · ${analysis.coreThesis.slice(0, 80)}`,
        output: analysis,
      },
    };
  },
};
