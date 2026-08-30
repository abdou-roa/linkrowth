import type { Post } from "../core/types";

/** Query-construction strategies. `raw` is the pre-Tier-A blob baseline. */
export type QueryConstructionTier = "raw" | "a";

export const DEFAULT_QUERY_CONSTRUCTION_TIER: QueryConstructionTier = "a";

export interface RetrievalQuery {
  /** Text that is embedded. Headline is never mixed in. */
  situationQuery: string;
  /** Author headline, kept for a later lexical/BM25 or tie-break channel. */
  headline: string;
  /** Which construction path produced `situationQuery`. */
  tier: QueryConstructionTier;
  /** True when cleaning produced nothing usable and we fell back to the trimmed body. */
  fallback: boolean;
  /** Length of the original post body (`post.text`). */
  rawLength: number;
  /** Length of `situationQuery`. */
  constructedLength: number;
}

export interface BuildRetrievalQueryOptions {
  /** Override `LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION`. */
  tier?: QueryConstructionTier;
}

const CTA_LINE =
  /^(thoughts|your thoughts|your take|what do you (?:all )?think|agree|disagree|follow(?: me)? for more(?: .+)?|like(?: and| &)? (?:share|comment|follow)(?: .+)?|comment below(?: .+)?|drop (?:a comment|your thoughts)(?: .+)?|let'?s discuss(?: .+)?|curious to hear(?: .+)?|hit follow(?: .+)?|subscribe for more(?: .+)?|link in (?:the )?comments(?: .+)?|repost if(?: .+)?)$/i;

/** Trailing sentence that is only engagement bait, not a problem statement. */
const CTA_SUFFIX =
  /\s+(?:thoughts|your thoughts|what do you (?:all )?think|agree|let'?s discuss)\??\s*$/i;

export function parseQueryConstructionTier(
  raw: string | undefined
): QueryConstructionTier {
  const value = raw?.trim().toLowerCase();
  if (value === "raw" || value === "baseline" || value === "0") return "raw";
  if (value === "a" || value === "1" || !value) return "a";
  return DEFAULT_QUERY_CONSTRUCTION_TIER;
}

export function resolveQueryConstructionTier(
  override?: QueryConstructionTier
): QueryConstructionTier {
  if (override) return override;
  return parseQueryConstructionTier(process.env.LINKROWTH_RETRIEVAL_QUERY_CONSTRUCTION);
}

/**
 * Build the retrieval query from a post.
 *
 * Tier A: embed the cleaned post body only. Headline is returned as a sibling
 * field and is never prepended into `situationQuery`.
 * If cleaning would leave nothing, fall back to the trimmed raw body.
 */
export function buildRetrievalQuery(
  post: Post,
  options: BuildRetrievalQueryOptions = {}
): RetrievalQuery {
  const headline = post.author?.headline?.trim() ?? "";
  const body = post.text ?? "";
  const rawLength = body.length;
  const tier = resolveQueryConstructionTier(options.tier);

  if (tier === "raw") {
    const trimmed = body.trim();
    const situationQuery =
      headline && trimmed
        ? `Author headline: ${headline}\n\n${trimmed}`
        : trimmed || headline;
    return {
      situationQuery,
      headline,
      tier: "raw",
      fallback: false,
      rawLength,
      constructedLength: situationQuery.length,
    };
  }

  const cleaned = cleanSituationText(body);
  return {
    situationQuery: cleaned.text,
    headline,
    tier: "a",
    fallback: cleaned.fallback,
    rawLength,
    constructedLength: cleaned.text.length,
  };
}

/** Deterministic boilerplate strip used by Tier A. Exported for unit tests. */
export function cleanSituationText(body: string): { text: string; fallback: boolean } {
  const raw = body.trim();
  if (!raw) return { text: "", fallback: false };

  const kept = raw.split(/\r?\n/);
  while (kept.length > 0 && isDroppableTrailingLine(kept[kept.length - 1] ?? "")) {
    kept.pop();
  }

  let text = kept.join("\n");
  text = stripEmojis(text);
  text = stripMentions(text);
  text = decodeInlineHashtags(text);
  text = stripTrailingCtaSuffix(text);
  text = collapseWhitespace(text);

  if (!text) return { text: raw, fallback: true };
  return { text, fallback: false };
}

function isDroppableTrailingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;

  const withoutDecor = stripEmojis(stripMentions(decodeInlineHashtags(trimmed)));
  const compact = collapseWhitespace(withoutDecor);
  if (!compact) return true;
  if (isHashtagWall(trimmed)) return true;
  return CTA_LINE.test(stripTrailingPunctuation(compact));
}

function isHashtagWall(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(
    (token) => /^#[\p{L}\p{N}_]+$/u.test(token) || /^@[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*$/u.test(token)
  );
}

function stripEmojis(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, "");
}

function stripMentions(text: string): string {
  return text.replace(/@[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*/gu, "");
}

/** Keep the hashtag word (technical signal) but drop the `#` marker. */
function decodeInlineHashtags(text: string): string {
  return text.replace(/#([\p{L}\p{N}_]+)/gu, "$1");
}

function stripTrailingCtaSuffix(text: string): string {
  const trimmed = text.trimEnd();
  const match = CTA_SUFFIX.exec(trimmed);
  if (!match) return trimmed;
  const cut = trimmed.slice(0, match.index).trimEnd();
  return cut || trimmed;
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?…]+$/u, "").trim();
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
