  import { extractJsonBlock } from "../core/parse";
  import type { UserContext } from "../core/types";
  import type {
    AnalysisArtifact,
    AuthorSeniority,
    PostQuestion,
    PostTone,
    QuestionReplyDecision,
    SuggestedLength,
    TechnicalDepth,
  } from "./types";
  import type { Step, StepResult } from "./types";
  import type { EngageState, StepDeps } from "./types";
  import { answerableQuestions } from "./types";

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
  (not available — leave "unspokenTradeoffs" empty and keep "pivotStrategy.insightDirection" focused on the post's own thesis rather than inventing a domain fit.)`;
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

  QUESTION EXTRACTION RULES:
  - Extract EVERY question in the post into "postQuestions" — not just the closing CTA. Include:
    - Sentences ending in "?"
    - Clear interrogative asks without "?", e.g. "Curious how others handle this.", "Wondering if anyone has shipped this."
  - Lightly paraphrase only when needed for clarity; prefer the author's wording.
  - If the post contains no questions, return an empty array [].

  For each extracted question, set "decision" and a one-line "reason":
  - "answer": a genuine invitation for readers to respond — a direct audience ask, open call for opinions/experience, or CTA question the author expects replies to.
  - "omit": not worth answering in a comment — rhetorical devices, stylistic hooks, questions the author immediately answers themselves, self-directed musings, asks aimed at a named person/company, or hypothetical framing that isn't seeking a reply.

  Bias toward "omit" when unsure. A LinkedIn comment should answer at most the real reader asks; do not treat every "?" as an obligation.

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
  - "insightDirection": The specific engineering argument, reality, or question the drafter must inject. Write this as a direct command to the drafter, NOT as the final comment prose.
    - BAD (Micromanaging): "I completely agree, when we built this, Redis latency was an issue."
    - BAD (Too abstract): "redis-latency-limits"
    - GOOD (Clear Direction): "Point out that Redis latency limits will eventually bottleneck this architecture at scale."
    - GOOD (Clear Direction): "Argue that the async context-switching tax outweighs the focus benefits they mentioned."
  - CRITICAL ESCAPE HATCH: If the post is entirely outside the niche stated in USER DOMAIN CONTEXT above, DO NOT force a connection. Instead, set "insightDirection" to a thoughtful instruction focused purely on the original author's thesis.

  RESPONSE PARAMETERS RULES:
  Decide these in order: technicalDepth first (vocabulary register), then suggestedLength from how deep the insightDirection itself needs to go.

  - "technicalDepth" (decide first — audience register, NOT comment length):
    - "high" ONLY when category is "technical" AND authorProfile.isTechnical is true — signals the drafter to use precise, low-level engineering terminology.
    - "accessible" for founders, non-technical authors, or achievement/informal posts — signals the drafter to stick to high-level business/operational realities without code-level jargon.

  - "suggestedLength" (decide second — base this STRICTLY on how technically deep "insightDirection" is, i.e. how much the drafter must unpack):
    Do NOT base this on the original post's length, word count, or how technical the post itself is. A highly technical post can still warrant a short comment if the insightDirection is a single sharp point; a simpler post can warrant more room if the insightDirection must unpack a real trade-off.
    Also weigh "unspokenTradeoffs" and any postQuestions with decision "answer" only insofar as they deepen what insightDirection must cover.
    When in doubt between two lengths, always choose the shorter one. Brevity signals seniority.

    Length scale (driven by insightDirection depth):
    - "short": the insightDirection is a single straightforward point, recognition, or observation — one beat, no setup required.
    - "standard": the insightDirection needs a brief setup plus the pivot (e.g. one operational nuance, or answering an answerable postQuestion alongside the acknowledgment).
    - "extended": ONLY when category is "technical" AND technicalDepth is "high" AND the insightDirection unpacks a real architectural / systems trade-off (typically with populated unspokenTradeoffs) AND you must also answer at least one postQuestion marked "answer".

    Category caps:
    - "achievement" / "informal": default "short"; bump to "standard" only when insightDirection genuinely needs two beats or there is an answerable postQuestion. Never "extended".
    - "technical" + technicalDepth "accessible": same scale as above but never "extended" — accessible insights stay at "short" or "standard".

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
    "postQuestions": [
      {
        "text": "<exact or paraphrased question>",
        "decision": "answer | omit",
        "reason": "<one-line rationale>"
      }
    ],
    "unspokenTradeoffs": [
      "<concept from the post bridged to the user's specific niche>"
    ],
    "riskFlags": [
      "<sensitive topic to handle carefully>"
    ],
    "pivotStrategy": {
      "acknowledgedPoint": "<specific claim or detail from the post>",
      "insightDirection": "<direct command telling the drafter what argument/stance to inject>"
    },
    "responseParameters": {
      "technicalDepth": "high | accessible",
      "suggestedLength": "short | standard | extended"
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
  const VALID_QUESTION_DECISIONS: QuestionReplyDecision[] = ["answer", "omit"];

  function parsePostQuestions(raw: unknown): PostQuestion[] {
    if (!Array.isArray(raw)) return [];

    return raw.reduce<PostQuestion[]>((questions, entry) => {
      const candidate = entry as Partial<PostQuestion>;
      const text = typeof candidate?.text === "string" ? candidate.text.trim() : "";
      if (!text) return questions;

      const decision = VALID_QUESTION_DECISIONS.includes(
        candidate.decision as QuestionReplyDecision,
      )
        ? (candidate.decision as QuestionReplyDecision)
        : "omit";

      const reason =
        typeof candidate.reason === "string" && candidate.reason.trim()
          ? candidate.reason.trim()
          : decision === "answer"
            ? "Classified as a genuine reader ask."
            : "Classified as not requiring a reply.";

      questions.push({ text, decision, reason });
      return questions;
    }, []);
  }

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

    // Normalise: extract + classify every question; default unknown decisions to omit
    parsed.postQuestions = parsePostQuestions(parsed.postQuestions);

    // Depth first: "high" requires a technical category AND a technical author,
    // regardless of what the model returned.
    const requestedDepth = VALID_DEPTHS.includes(parsed.responseParameters?.technicalDepth)
      ? parsed.responseParameters.technicalDepth
      : "accessible";
    const technicalDepth =
      requestedDepth === "high" &&
      parsed.category === "technical" &&
      parsed.authorProfile.isTechnical
        ? "high"
        : "accessible";

    let suggestedLength: SuggestedLength = VALID_LENGTHS.includes(
      parsed.responseParameters?.suggestedLength,
    )
      ? parsed.responseParameters.suggestedLength
      : "standard";

    // A "short" budget can't hold an acknowledgment, an injected insight, and an
    // answer to a direct question — the answer is what gets dropped. Floor it.
    if (answerableQuestions(parsed).length > 0 && suggestedLength === "short") {
      suggestedLength = "standard";
    }

    // Cap length: extended is reserved for high-depth technical insights only.
    if (parsed.category === "achievement" || parsed.category === "informal") {
      if (suggestedLength === "extended") suggestedLength = "standard";
    } else if (parsed.category === "technical" && technicalDepth === "accessible") {
      if (suggestedLength === "extended") suggestedLength = "standard";
    }

    parsed.responseParameters = {
      technicalDepth,
      suggestedLength,
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
          summary: `${analysis.category} · ${analysis.tone} · ${analysis.authorProfile.isTechnical ? "technical author" : "non-technical author"} · ${analysis.responseParameters.technicalDepth}/${analysis.responseParameters.suggestedLength} · ${analysis.coreThesis.slice(0, 80)}`,
          output: analysis,
        },
      };
    },
  };
