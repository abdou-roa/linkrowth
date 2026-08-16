  import { getStepModel } from "../config/llm";
  import { extractJsonBlock } from "../core/parse";
  import type { UserContext } from "../core/types";
  import type {
    AnalysisArtifact,
    AuthorSeniority,
    HumanClarification,
    PostQuestion,
    PostTone,
    QuestionReplyDecision,
    SuggestedLength,
    TechnicalDepth,
  } from "./types";
  import type { Step, StepResult } from "./types";
  import type { EngageState, StepDeps } from "./types";
  import { answerableQuestions } from "./types";

  /** Analyzer-only shape before it is mapped onto HumanClarification. */
  interface ClarificationRequest {
    needed: boolean;
    question: string;
    reason: string;
  }

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

  CORE THESIS RULES:
  - "coreThesis" is a top-level field, not part of "pivotStrategy".
  - Faithfully summarize the author's main point, argument, or update in 1–3 sentences, using additional sentences only when needed to preserve important nuance in a deep post.
  - Preserve the author's actual stance and subject. Do not replace it with a supporting detail, question, inferred motivation, or the commenter's perspective.

  PIVOT STRATEGY RULES:
  - "acknowledgedPoint": The single strongest specific detail from the post worth referencing (a number, named tool, specific tradeoff, or quote).
  - "insightDirection": The specific command guiding what the drafter must execute.
    - IF POST HAS QUESTIONS: "insightDirection" MUST be an explicit command on HOW to answer or reframe the author's primary question using the user's technical perspective.
      - Example: "Answer their question about scale limits by pointing out that connection-pooling will fail before memory does."
    - IF NO QUESTIONS: Focus on an additive pivot or operational edge case.
      - Example: "Point out that Redis latency limits will eventually bottleneck this architecture at scale."
  - CRITICAL ESCAPE HATCH: If the post is outside USER DOMAIN CONTEXT, set "insightDirection" to a thoughtful response focused purely on the author's thesis and question.
  
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

  HUMAN CLARIFICATION RULES:
  - Decide whether a grounded comment requires a fact only the commenter can provide (their experience, stance, result, preference, relationship, or intent).
  - Set "clarification.needed" to true ONLY when drafting without that answer would force invention or a generic substitute.
  - When needed is true:
    - "question": one focused, answerable question for the commenter (not for the post author).
    - "reason": one line explaining what the drafter will do with the answer.
  - When needed is false: set question and reason to "".
  - Prefer needed=false when USER DOMAIN CONTEXT, the post, and a careful generic contribution are already enough.
  - Never ask for information already present in USER DOMAIN CONTEXT.
  - Ask at most one question. Do not ask multi-part questionnaires.

  OUTPUT FORMAT:
  Return only the JSON object. No markdown fences, no explanation.

  {
    "category": "technical | achievement | informal",
    "coreThesis": "<accurate 1–3 sentence summary of the author's main point>",
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
    },
    "clarification": {
      "needed": false,
      "question": "",
      "reason": ""
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

  function parseClarificationRequest(raw: unknown): ClarificationRequest {
    const candidate = (raw ?? {}) as Partial<ClarificationRequest>;
    const question =
      typeof candidate.question === "string" ? candidate.question.trim() : "";
    const reason =
      typeof candidate.reason === "string" ? candidate.reason.trim() : "";
    const needed = Boolean(candidate.needed) && question.length > 0;

    return {
      needed,
      question: needed ? question : "",
      reason: needed
        ? reason || "Needed so the drafter can ground the comment in the user's real answer."
        : "",
    };
  }

  function toHumanClarification(
    request: ClarificationRequest,
  ): HumanClarification {
    if (!request.needed) {
      return { status: "not_needed" };
    }

    return {
      status: "pending",
      question: request.question,
      reason: request.reason,
      askedAt: new Date().toISOString(),
    };
  }

  function parseAnalysis(raw: string): {
    analysis: AnalysisArtifact;
    clarificationRequest: ClarificationRequest;
  } {
    const json = extractJsonBlock(raw);
    const parsed = JSON.parse(json) as AnalysisArtifact & {
      pivotStrategy?: AnalysisArtifact["pivotStrategy"] & { coreThesis?: unknown };
      clarification?: unknown;
    };
    const clarificationRequest = parseClarificationRequest(parsed.clarification);

    // Keep coreThesis at the top-level contract. Accept the old nested shape so
    // an occasional stale/model response still reaches the drafter correctly.
    const topLevelCoreThesis =
      typeof parsed.coreThesis === "string" ? parsed.coreThesis.trim() : "";
    const nestedCoreThesis =
      typeof parsed.pivotStrategy?.coreThesis === "string"
        ? parsed.pivotStrategy.coreThesis.trim()
        : "";
    parsed.coreThesis = topLevelCoreThesis || nestedCoreThesis;
    if (!parsed.coreThesis) {
      throw new Error("Could not parse analyzer response — missing a non-empty coreThesis.");
    }

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

    // Drop analyzer-only clarification field from the analysis artifact.
    delete (parsed as { clarification?: unknown }).clarification;

    return {
      analysis: parsed,
      clarificationRequest,
    };
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
        model: getStepModel("analyze"),
        system: buildSystemPrompt(state.context),
        user: buildUserMessage(state),
        maxTokens: 768,
      });

      const { analysis, clarificationRequest } = parseAnalysis(raw);
      const clarification = toHumanClarification(clarificationRequest);
      const awaiting = clarification.status === "pending";

      console.log(
        "\n========== ANALYZER OUTPUT ==========\n" +
          JSON.stringify({ analysis, clarification }, null, 2) +
          "\n=====================================\n",
      );

      return {
        patch: {
          analysis,
          clarification,
          ...(awaiting ? { status: "awaiting_clarification" as const } : {}),
        },
        record: {
          name: "analyze",
          status: "completed",
          summary: awaiting
            ? `clarification needed · ${clarification.question?.slice(0, 80)}`
            : `${analysis.category} · ${analysis.tone} · ${analysis.authorProfile.isTechnical ? "technical author" : "non-technical author"} · ${analysis.responseParameters.technicalDepth}/${analysis.responseParameters.suggestedLength} · ${analysis.coreThesis.slice(0, 80)}`,
          output: { analysis, clarification },
        },
      };
    },
  };
