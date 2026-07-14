import type { FeedPost } from "../shared/types";

/**
 * Extract a FeedPost from a LinkedIn feed card.
 * Tries modern data-view-name / data-testid hooks first, then legacy class names.
 */
export function extractFeedPost(card: HTMLElement): FeedPost | null {
  const text = extractText(card);
  const url = extractUrl(card);
  const id = extractId(card, url, text);

  if (!id) return null;

  // Media-only posts still get a card entry (empty text).
  card.dataset.linkrowthPostId = id;

  const profileUrl = extractAuthorProfileUrl(card);

  return {
    id,
    url,
    text: text || "",
    author: {
      name: extractAuthorName(card),
      headline: extractHeadline(card),
      profileUrl,
      username: profileUrl ? usernameFromProfileUrl(profileUrl) : undefined,
    },
    metrics: {
      likes: parseCount(extractReactions(card)),
      commentsCount: parseCount(extractComments(card)),
    },
    ageText: extractAgeText(card, id, url),
    extractedAt: new Date().toISOString(),
  };
}

function extractText(card: HTMLElement): string {
  const node = card.querySelector(
    [
      '[data-testid="expandable-text-box"]',
      '[data-view-name="feed-commentary"]',
      ".update-components-update-v2__commentary",
      ".feed-shared-update-v2__description",
      ".feed-shared-inline-show-more-text",
      ".update-components-text",
      ".feed-shared-text",
      ".break-words",
    ].join(", "),
  );
  if (!node) return "";
  const clone = node.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      '[data-testid="expandable-text-button"], .feed-shared-inline-show-more-text__see-more-less-toggle',
    )
    .forEach((el) => el.remove());
  return textOf(clone);
}

function extractAuthorName(card: HTMLElement): string | undefined {
  const scope = actorRoot(card);

  // 1) Visible name next to the avatar / on the profile meta link.
  const nameSelectors = [
    '[data-view-name="feed-actor-image"] + a p',
    '[data-view-name="feed-actor-image"] ~ a p',
    '[data-view-name="feed-header-text"]',
    ".update-components-actor__title span[aria-hidden='true']",
    ".update-components-actor__title span[dir='ltr'] > span[aria-hidden='true']",
    ".update-components-actor__title",
    ".feed-shared-actor__name",
    ".update-components-actor__meta-link span[aria-hidden='true']",
    ".update-components-actor__meta-link",
    'a[href*="/in/"] span[aria-hidden="true"]',
    'a[href*="/in/"] p',
  ];

  for (const sel of nameSelectors) {
    const name = cleanAuthorName(textOf(scope.querySelector(sel)));
    if (name) return name;
  }

  // 2) First /in/ profile link in the actor chrome — text or aria-label.
  for (const anchor of scope.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/in/"]',
  )) {
    const fromAria = nameFromProfileAria(anchor.getAttribute("aria-label"));
    if (fromAria) return fromAria;

    const fromText = cleanAuthorName(textOf(anchor));
    if (fromText) return fromText;
  }

  // 3) Control-menu aria: "Open control menu for … by Jane Doe"
  const menu = extractionRoot(card).querySelector<HTMLElement>(
    'button[aria-label*="control menu" i], button[aria-label*="Open control menu" i]',
  );
  const label = menu?.getAttribute("aria-label") ?? "";
  const match = label.match(/\bby (.+)$/i);
  return cleanAuthorName(match?.[1] ?? "") || undefined;
}

/** Strip age / degree / "• 1st" junk that often rides along with the name node. */
function cleanAuthorName(raw: string): string | undefined {
  let text = raw
    .replace(/[\u200e\u200f\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;

  // LinkedIn aria / link copy: "View profile for Jane Doe", "View Jane Doe's profile"
  text = text
    .replace(/^view\s+profile\s+for\s+/i, "")
    .replace(/^view\s+(.+?)(?:['’]s)?\s+profile$/i, "$1")
    .trim();

  // Drop trailing meta: "Jane Doe • 1st", "Jane Doe 2h", "Jane Doe Verified"
  const cleaned = text
    .split(/\s*[•·|]\s*/)[0]
    ?.replace(
      /\s+(?:\d+(?:\.\d+)?(?:mo|[smhdw])|just\s*now|\d+(?:st|nd|rd|th)|Verified|Premium)\s*$/i,
      "",
    )
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return undefined;
  // Reject pure relative-age or "Promoted" labels.
  if (/^(?:promoted|sponsored|\d+(?:\.\d+)?(?:mo|[smhdw])|just\s*now)$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/** e.g. "View profile for Jane Doe", "View Jane Doe’s profile", "Jane Doe" */
function nameFromProfileAria(aria: string | null): string | undefined {
  if (!aria) return undefined;
  return cleanAuthorName(aria);
}

function extractHeadline(card: HTMLElement): string | undefined {
  const h = textOf(
    card.querySelector(
      '.update-components-actor__description span[aria-hidden="true"], .update-components-actor__description',
    ),
  );
  return h || undefined;
}

/** Actor / header region — avoids profile links in post body or comments. */
function actorRoot(card: HTMLElement): HTMLElement {
  const root = extractionRoot(card);

  // Prefer wrappers that include both avatar + name text (not the image leaf alone).
  const actor = root.querySelector(
    [
      ".update-components-actor",
      ".feed-shared-actor",
      '[data-view-name="feed-header"]',
      '[data-view-name*="feed-header"]',
      ".update-components-header",
      ".feed-shared-header",
    ].join(", "),
  );
  if (actor instanceof HTMLElement) return actor;

  // Modern feed: climb from the avatar to a parent that also contains an /in/ name link.
  const avatar = root.querySelector(
    '[data-view-name="feed-actor-image"], [data-view-name*="feed-actor"]',
  );
  if (avatar instanceof HTMLElement) {
    let current: HTMLElement = avatar;
    for (let i = 0; i < 6; i += 1) {
      const next = current.parentElement;
      if (!(next instanceof HTMLElement) || next === root) break;
      current = next;
      if (
        current.querySelectorAll('a[href*="/in/"]').length >= 1 &&
        current.querySelector("p, span")
      ) {
        return current;
      }
    }
    return avatar.parentElement instanceof HTMLElement
      ? avatar.parentElement
      : avatar;
  }

  return root;
}

function extractAuthorProfileUrl(card: HTMLElement): string | undefined {
  const scope = actorRoot(card);

  const selectors = [
    'a[data-view-name="feed-actor-image"][href*="/in/"]',
    '[data-view-name="feed-actor-image"] a[href*="/in/"]',
    '[data-view-name="feed-actor-image"] + a[href*="/in/"]',
    ".update-components-actor__meta-link",
    ".feed-shared-actor__meta-link",
    ".update-components-actor__image-link",
    'a[href*="/in/"]',
  ];

  for (const sel of selectors) {
    const anchor = scope.querySelector<HTMLAnchorElement>(sel);
    const normalized = anchor?.href
      ? normalizeLinkedInProfileUrl(anchor.href)
      : undefined;
    if (normalized) return normalized;
  }

  return undefined;
}

function normalizeLinkedInProfileUrl(href: string): string | undefined {
  try {
    const url = new URL(href, "https://www.linkedin.com");
    const match = url.pathname.match(/\/in\/([^/?#]+)/i);
    if (!match?.[1]) return undefined;
    const username = decodeURIComponent(match[1]);
    return `https://www.linkedin.com/in/${username}`;
  } catch {
    return undefined;
  }
}

export function usernameFromProfileUrl(url: string): string | undefined {
  try {
    const match = new URL(url, "https://www.linkedin.com").pathname.match(
      /\/in\/([^/?#]+)/i,
    );
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Social counts / age often live on the outer listitem while we observe an inner
 * `feed-full-update` node — prefer the outer shell when present.
 */
function extractionRoot(card: HTMLElement): HTMLElement {
  const outer = card.closest(
    'div[role="listitem"][componentkey*="FeedType"], article[data-id="main-feed-card"]',
  );
  return outer instanceof HTMLElement ? outer : card;
}

/**
 * Relative age for scoring.
 * 1) DOM labels near the actor ("2h", "1d")
 * 2) Fallback: decode publish time from LinkedIn activity / ugcPost snowflake IDs
 *    (first 41 bits = Unix ms) — survives hashed/CSS-in-JS class names.
 */
function extractAgeText(
  card: HTMLElement,
  id: string,
  url: string | undefined,
): string | undefined {
  const root = extractionRoot(card);

  const fromDom = ageFromDom(root);
  if (fromDom) return fromDom;

  const fromIds = ageFromLinkedInSnowflakes(root, id, url);
  if (fromIds) return fromIds;

  return undefined;
}

function ageFromDom(root: HTMLElement): string | undefined {
  const timestampSelectors = [
    // Legacy stable classes (still appear on some clients)
    "span.update-components-actor__sub-description > span",
    '.update-components-actor__sub-description span[aria-hidden="true"]',
    ".update-components-actor__sub-description",
    '.feed-shared-actor__sub-description span[aria-hidden="true"]',
    ".feed-shared-actor__sub-description",
    // Modern actor meta
    '[data-view-name="feed-actor-image"] + a p:nth-of-type(3)',
    '[data-view-name="feed-actor-image"] ~ div p:nth-of-type(3)',
    '[data-view-name="feed-actor-image"] ~ a p:nth-of-type(3)',
    '[data-view-name="feed-actor-meta"]',
    "time",
  ];

  for (const sel of timestampSelectors) {
    for (const el of root.querySelectorAll(sel)) {
      if (!(el instanceof HTMLElement)) continue;
      const hit = ageFromElement(el);
      if (hit) return hit;
    }
  }

  // Header/actor region only — avoid matching "1d" / "3 months" inside post body.
  const header =
    root.querySelector(
      [
        ".update-components-actor",
        ".feed-shared-actor",
        '[data-view-name*="feed-actor"]',
        '[data-view-name*="feed-header"]',
        ".update-components-header",
        ".feed-shared-header",
      ].join(", "),
    ) ?? null;

  const scope = header instanceof HTMLElement ? header : root;
  for (const el of scope.querySelectorAll("span, p, time, a, div")) {
    if (!(el instanceof HTMLElement)) continue;
    // Prefer compact leaf / short nodes (LinkedIn age is tiny).
    const text = cleanInvisible(el.textContent ?? "");
    if (!text || text.length > 20) continue;
    if (el.children.length > 2 && text.length > 8) continue;
    const hit = matchAgeSnippet(text);
    if (hit && isPlausibleAgeLabel(hit, text)) return hit;
  }

  // Aria / title sweep in the header region
  for (const el of scope.querySelectorAll("[aria-label], [title]")) {
    if (!(el instanceof HTMLElement)) continue;
    const hit =
      matchAgeSnippet(el.getAttribute("aria-label") ?? "") ||
      matchAgeSnippet(el.getAttribute("title") ?? "");
    if (hit && isPlausibleAgeLabel(hit)) return hit;
  }

  // Last DOM pass: compact labels anywhere above the commentary block.
  const commentary = root.querySelector(
    [
      '[data-view-name="feed-commentary"]',
      '[data-testid="expandable-text-box"]',
      ".update-components-update-v2__commentary",
      ".feed-shared-update-v2__description",
    ].join(", "),
  );
  for (const el of root.querySelectorAll("span, p, time")) {
    if (!(el instanceof HTMLElement)) continue;
    if (commentary?.contains(el)) continue;
    // Skip nodes that appear after the post body.
    if (
      commentary &&
      (el.compareDocumentPosition(commentary) & Node.DOCUMENT_POSITION_PRECEDING) !==
        0
    ) {
      continue;
    }
    const text = cleanInvisible(el.textContent ?? "");
    if (!text || text.length > 8) continue;
    const compact = text.match(/^(\d+(?:\.\d+)?)(mo|[smhdw])$/i);
    if (compact) return `${compact[1]}${compact[2].toLowerCase()}`;
  }

  return undefined;
}

function ageFromElement(el: HTMLElement): string | undefined {
  const fromAttr =
    matchAgeSnippet(el.getAttribute("aria-label") ?? "") ||
    matchAgeSnippet(el.getAttribute("title") ?? "") ||
    matchAgeSnippet(el.getAttribute("datetime") ?? "");
  if (fromAttr && isPlausibleAgeLabel(fromAttr)) return fromAttr;

  const text = cleanInvisible(el.textContent ?? "");
  const hit = matchAgeSnippet(text);
  if (hit && isPlausibleAgeLabel(hit, text)) return hit;
  return undefined;
}

/**
 * Prefer compact LinkedIn labels. Reject loose "3 months" hits inside long
 * headline copy ("3 months at Acme") unless the whole node is basically the age.
 */
function isPlausibleAgeLabel(hit: string, fullText?: string): boolean {
  if (/^just\s*now$/i.test(hit) || /^now$/i.test(hit)) return true;
  if (/^\d+(?:\.\d+)?(mo|[smhdw])$/i.test(hit)) return true;
  if (/^\d+(?:\.\d+)?\s*(minutes?|mins?|hours?|hrs?|hr|days?|weeks?|months?)\s*(ago)?$/i.test(hit)) {
    return true;
  }
  if (fullText && fullText.length <= 24 && fullText.includes(hit)) return true;
  return false;
}

/**
 * LinkedIn activity / ugcPost IDs encode Unix-ms in the first 41 bits.
 * Convert to the same relative labels the feed shows ("2h", "1d", …).
 */
function ageFromLinkedInSnowflakes(
  root: HTMLElement,
  id: string,
  url: string | undefined,
): string | undefined {
  const snowflakes = collectSnowflakeIds(root, id, url);
  let best: { ms: number; label: string } | undefined;

  for (const snowflake of snowflakes) {
    const publishedMs = snowflakeToUnixMs(snowflake);
    if (publishedMs === undefined) continue;
    const ageMs = Date.now() - publishedMs;
    // Ignore absurd values (clock skew, non-snowflake numbers).
    if (ageMs < -5 * 60_000 || ageMs > 8 * 365 * 24 * 3600_000) continue;
    const label = formatRelativeAge(Math.max(0, ageMs));
    if (!best || publishedMs > best.ms) {
      // Prefer the newest id (closest to "now") — usually the visible update.
      best = { ms: publishedMs, label };
    }
  }

  return best?.label;
}

function collectSnowflakeIds(
  root: HTMLElement,
  id: string,
  url: string | undefined,
): string[] {
  const found = new Set<string>();
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    for (const match of raw.matchAll(
      /(?:urn:li:)?(?:activity|ugcPost|share)[:\-](\d{15,22})|(?:activity-|activity:)(\d{15,22})|\b(\d{19})\b/gi,
    )) {
      const n = match[1] || match[2] || match[3];
      if (n) found.add(n);
    }
  };

  push(id);
  push(url);
  push(root.getAttribute("data-urn"));
  push(root.getAttribute("data-id"));
  push(root.getAttribute("componentkey"));
  push(root.getAttribute("data-activity-urn"));

  for (const el of root.querySelectorAll(
    "[data-urn], [data-id], [componentkey], a[href*='activity'], a[href*='ugcPost'], a[href*='feed/update']",
  )) {
    if (!(el instanceof HTMLElement)) continue;
    push(el.getAttribute("data-urn"));
    push(el.getAttribute("data-id"));
    push(el.getAttribute("componentkey"));
    if (el instanceof HTMLAnchorElement) push(el.href);
  }

  return [...found];
}

function snowflakeToUnixMs(id: string): number | undefined {
  try {
    const bits = BigInt(id).toString(2);
    if (bits.length < 41) return undefined;
    const ms = Number.parseInt(bits.slice(0, 41), 2);
    if (!Number.isFinite(ms) || ms < 1_000_000_000_000) return undefined;
    return ms;
  } catch {
    return undefined;
  }
}

function formatRelativeAge(ageMs: number): string {
  const minutes = ageMs / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = hours / 24;
  if (days < 7) return `${Math.max(1, Math.round(days))}d`;
  const weeks = days / 7;
  if (weeks < 5) return `${Math.max(1, Math.round(weeks))}w`;
  const months = days / 30;
  return `${Math.max(1, Math.round(months))}mo`;
}

function cleanInvisible(raw: string): string {
  return raw
    .replace(/[\u200e\u200f\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Matches "2h", "15m", "1d", "3 hours ago", "Just now", etc. */
const AGE_SNIPPET_RE =
  /(?:just\s*now|\bnow\b|\d+(?:\.\d+)?\s*(?:months?|mo|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|m)(?:\s*ago)?)\b/i;

function matchAgeSnippet(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = cleanInvisible(raw);
  // Compact LinkedIn labels: "2h", "15m", "1d", "3w" (no space)
  const compact = cleaned.match(/\b(\d+(?:\.\d+)?)(mo|[smhdw])\b/i);
  if (compact && cleaned.length <= 12) {
    return `${compact[1]}${compact[2].toLowerCase()}`;
  }
  const match = cleaned.match(AGE_SNIPPET_RE);
  if (!match) return undefined;
  return match[0].replace(/\s+/g, " ").trim();
}

/**
 * Reaction count: prefer data-view-name / aria-label ("42 reactions").
 * Comments already had an aria-label fallback — reactions need the same.
 */
function extractReactions(card: HTMLElement): string | undefined {
  const root = extractionRoot(card);

  const nodes = root.querySelectorAll(
    [
      '[data-view-name="feed-reaction-count"]',
      ".social-details-social-counts__reactions-count",
      ".social-details-social-counts__reactions",
      'button[aria-label*="reaction" i]',
      '[aria-label*="reaction" i]',
      'button[aria-label*=" others" i]',
    ].join(", "),
  );

  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    const fromAria = countFromReactionAria(el.getAttribute("aria-label"));
    if (fromAria) return fromAria;

    const text = textOf(el);
    if (!text || /comment|repost|share/i.test(text)) continue;
    if (parseCount(text) !== undefined) return text;
  }

  // Visible social-proof text sometimes has no stable attr.
  const social = root.querySelector(
    '.social-details-social-counts, [data-view-name*="social-count"], [data-view-name*="reaction"]',
  );
  if (social) {
    const match = textOf(social).match(
      /([\d,.]+[KkMm]?)\s*reactions?\b/i,
    );
    if (match) return match[1];
  }

  return undefined;
}

/** e.g. "42 reactions", "Jane and 41 others", "Open reactions list: 12 reactions" */
function countFromReactionAria(aria: string | null): string | undefined {
  if (!aria) return undefined;
  const reactions = aria.match(/([\d,.]+[KkMm]?)\s*reactions?\b/i);
  if (reactions) return reactions[1];
  const others = aria.match(
    /(?:and|&)\s*([\d,.]+[KkMm]?)\s*others?\b/i,
  );
  if (others) return others[1];
  return undefined;
}

function extractComments(card: HTMLElement): string | undefined {
  const root = extractionRoot(card);

  const nodes = root.querySelectorAll(
    [
      '[data-view-name="feed-comment-count"]',
      ".social-details-social-counts__comments",
      'button[aria-label*="comment" i]',
      '[aria-label*="comment" i]',
    ].join(", "),
  );

  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    const aria = el.getAttribute("aria-label") ?? "";
    const fromAria = aria.match(/([\d,.]+[KkMm]?)\s*comments?\b/i);
    if (fromAria) return fromAria[1];

    const text = textOf(el);
    if (!text || /reaction|repost|share/i.test(text)) continue;
    if (parseCount(text) !== undefined) return text;
  }

  return undefined;
}

function extractUrl(card: HTMLElement): string | undefined {
  const anchor = card.querySelector<HTMLAnchorElement>(
    'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="urn:li:activity"]',
  );
  return anchor?.href;
}

function extractId(
  card: HTMLElement,
  url: string | undefined,
  text: string,
): string | null {
  const componentKey =
    card.getAttribute("componentkey") ||
    card.closest("[componentkey]")?.getAttribute("componentkey");
  if (componentKey) return `ck:${componentKey}`;

  const urn =
    card.getAttribute("data-urn") ||
    card.getAttribute("data-id") ||
    card.closest("[data-urn]")?.getAttribute("data-urn") ||
    card.closest("[data-id]")?.getAttribute("data-id");
  if (urn) return urn;

  if (url) return `url:${url}`;
  if (text) return `hash:${simpleHash(text)}`;
  return null;
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.KkMm]/g, "");
  const match = cleaned.match(/([\d.]+)\s*([KkMm])?/);
  if (!match) return undefined;
  let n = Number(match[1]);
  if (Number.isNaN(n)) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") n *= 1_000;
  if (suffix === "m") n *= 1_000_000;
  return Math.round(n);
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
