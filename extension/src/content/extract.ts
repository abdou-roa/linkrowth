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

  // 1) First meta line next to the post author avatar (not activity header).
  const metaLines = actorMetaLines(scope);
  if (metaLines[0]) {
    const fromMeta = cleanAuthorName(metaLines[0]);
    if (fromMeta) return fromMeta;
  }

  // 2) Legacy title / meta-link selectors inside the author block.
  const nameSelectors = [
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
    const el = scope.querySelector(sel);
    if (!(el instanceof HTMLElement) || isInsideActivityHeader(el)) continue;
    const name = cleanAuthorName(textOf(el));
    if (name) return name;
  }

  // 3) Profile link beside the post author avatar — text or aria-label.
  for (const anchor of scope.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/in/"]',
  )) {
    if (isInsideActivityHeader(anchor)) continue;

    const fromAria = nameFromProfileAria(anchor.getAttribute("aria-label"));
    if (fromAria) return fromAria;

    const fromText = cleanAuthorName(textOf(anchor));
    if (fromText) return fromText;
  }

  // 4) Control-menu aria: "Open control menu for … by Jane Doe"
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
  if (isFeedChromeText(cleaned)) return undefined;
  return cleaned;
}

/** e.g. "View profile for Jane Doe", "View Jane Doe’s profile", "Jane Doe" */
function nameFromProfileAria(aria: string | null): string | undefined {
  if (!aria) return undefined;
  return cleanAuthorName(aria);
}

function extractHeadline(card: HTMLElement): string | undefined {
  const scope = actorRoot(card);
  const authorName = extractAuthorName(card)?.toLowerCase();
  const metaLines = actorMetaLines(scope);

  // Meta lines are typically [name, headline, age]. Skip the name slot and noise.
  for (let i = 0; i < metaLines.length; i += 1) {
    if (i === 0 && metaLines.length >= 2) continue;
    if (i === 0 && metaLines.length === 1) continue; // lone line is the name

    const headline = cleanHeadline(metaLines[i]);
    if (!headline) continue;
    if (authorName && headline.toLowerCase() === authorName) continue;
    return headline;
  }

  // Fallback: scan author chrome for the first non-name / non-age line.
  const scanned = scanActorHeadline(scope, authorName);
  if (scanned) return scanned;

  // Legacy description classes inside the author block.
  const legacySelectors = [
    '.update-components-actor__description span[aria-hidden="true"]',
    '.update-components-actor__description',
    '.feed-shared-actor__description span[aria-hidden="true"]',
    '.feed-shared-actor__description',
  ];
  for (const sel of legacySelectors) {
    const headline = cleanHeadline(textOf(scope.querySelector(sel)));
    if (!headline) continue;
    if (authorName && headline.toLowerCase() === authorName) continue;
    return headline;
  }

  return undefined;
}

/** Drop age / degree / promo / feed-chrome labels that land in the headline slot. */
function cleanHeadline(raw: string): string | undefined {
  const text = cleanInvisible(raw);
  if (!text || text.length < 2 || text.length > 220) return undefined;
  if (isFeedChromeText(text)) return undefined;
  return text;
}

/**
 * Feed chrome that must never become author name or headline:
 * "Suggested", "Greg Tomasik commented", "Jane liked this", age, etc.
 */
function isFeedChromeText(text: string): boolean {
  const t = cleanInvisible(text);
  if (!t) return true;

  // Exact UI badges / CTAs.
  if (
    /^(?:suggested|recommended|promoted|sponsored|verified|premium|follow|connect|following|\+?\s*follow|message|join|subscribe|just\s*now|now|\d+(?:st|nd|rd|th)|\d+(?:st|nd|rd|th)\+)$/i.test(
      t,
    )
  ) {
    return true;
  }
  // "Suggested for you", "Suggested · …"
  if (/^suggested\b/i.test(t) || /^recommended\b/i.test(t)) return true;

  // Pure relative age (and age-prefixed sub-description lines).
  if (/^\d+(?:\.\d+)?(?:mo|[smhdw])\b/i.test(t)) return true;
  if (
    /^(?:\d+(?:\.\d+)?(?:mo|[smhdw])|\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|hr|days?|weeks?|months?)(?:\s*ago)?)$/i.test(
      t,
    )
  ) {
    return true;
  }

  // Activity headers above the author — including "Greg Tomasik commented".
  if (isActivityHeaderPhrase(t)) return true;

  // Visibility / audience lines under the name.
  if (/\bvisible\s+to\b/i.test(t)) return true;
  if (/\bwho\s+can\s+see\s+this\s+post\b/i.test(t)) return true;

  return false;
}

/** "X commented", "X liked this", "A person reacted to this", etc. */
function isActivityHeaderPhrase(t: string): boolean {
  const text = cleanInvisible(t);
  if (!text || text.length > 120) return false;

  // Ends with the verb LinkedIn puts in the top strip.
  if (
    /\b(?:commented|reacted|reposted|liked|likes|loves|celebrates?|congratulated|shared)\s*$/i.test(
      text,
    )
  ) {
    return true;
  }
  // "… liked this", "… celebrates this", "… liked this post"
  if (
    /\b(?:liked|likes|loves|love|supports|finds|celebrates?|congratulated|reposted|shared|commented\s+on|reacted\s+to)\s+this(?:\s+post)?\.?$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^(?:a\s+person|someone)\b/i.test(text) && text.length < 80) return true;
  if (
    /\band\s+\d+\s+others?\b/i.test(text) &&
    /\b(?:liked|reacted|celebrated|reposted|shared|commented)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

/**
 * Visible text lines from the post author meta block (name / headline / age).
 * Scoped to `feed-actor-image` — never the celebration/repost header avatar.
 *
 * LinkedIn varies the chrome:
 * - `<a><p>Name</p><p>Headline</p><p>2h</p></a>`
 * - `<div><a><p>Name</p></a><p>Headline</p><p>2h</p></div>`
 * - `<div><a><span>Name</span></a><span>Headline</span><span>2h</span></div>`
 *
 * So we read ordered lines from the avatar's following sibling block(s), treating
 * each direct child as a line (and expanding multi-`<p>` children).
 */
function actorMetaLines(scope: HTMLElement): string[] {
  const root = scope;
  const avatar =
    postAuthorAvatar(root) ??
    (root.matches('[data-view-name="feed-actor-image"]') ? root : null);
  if (!(avatar instanceof HTMLElement)) return [];

  const lines: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const text = cleanInvisible(raw);
    if (!text || text.length > 220) return;
    if (isFeedChromeText(text)) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(text);
  };

  const ingestBox = (box: HTMLElement) => {
    if (isActivityHeaderContainer(box)) return;
    for (const child of Array.from(box.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === avatar || avatar.contains(child) || child.contains(avatar)) {
        continue;
      }
      if (child.getAttribute("data-view-name") === "feed-actor-image") continue;
      if (isInsideActivityHeader(child) || isActivityHeaderContainer(child)) {
        continue;
      }
      // Skip "Suggested" / reason / insight chips near the actor.
      if (
        child.closest(
          '[data-view-name*="suggested"], [data-view-name*="feed-reason"], [data-view-name*="insight"]',
        )
      ) {
        continue;
      }

      const leafPs = [...child.querySelectorAll("p")].filter(
        (p) =>
          p instanceof HTMLElement &&
          !p.querySelector("p") &&
          !isSrOnlyDuplicate(p),
      );

      // Profile link / block with several <p> lines (name + headline + age).
      if (leafPs.length >= 2) {
        for (const p of leafPs) push(paragraphVisibleText(p));
        continue;
      }

      // Single nested <p> (typical name link) — take that paragraph only.
      if (leafPs.length === 1 && !child.matches("p")) {
        push(paragraphVisibleText(leafPs[0] as HTMLElement));
        continue;
      }

      if (child.matches("p")) {
        if (!isSrOnlyDuplicate(child)) push(paragraphVisibleText(child));
        continue;
      }

      // Span/div line with optional aria-hidden visible copy.
      push(
        textOf(
          child.querySelector(':scope > span[aria-hidden="true"]') ??
            child.querySelector('span[aria-hidden="true"]') ??
            child,
        ),
      );
    }
  };

  // 1) Each following sibling is a meta column or a single meta line.
  let sib = avatar.nextElementSibling;
  while (sib) {
    if (sib instanceof HTMLElement) {
      if (isActivityHeaderContainer(sib)) {
        sib = sib.nextElementSibling;
        continue;
      }
      if (sib.matches("p")) {
        if (!isSrOnlyDuplicate(sib)) push(paragraphVisibleText(sib));
      } else if (sib.children.length > 0) {
        // Meta column: ingest each child as a line (name link, headline, age).
        ingestBox(sib);
        // Multi-<p> profile anchor: also expand direct paragraphs.
        const directPs = [...sib.querySelectorAll(":scope > p")].filter(
          (p) => p instanceof HTMLElement && !isSrOnlyDuplicate(p),
        );
        if (directPs.length >= 2) {
          for (const p of directPs) push(paragraphVisibleText(p as HTMLElement));
        }
      } else {
        push(textOf(sib.querySelector('span[aria-hidden="true"]') ?? sib));
      }
    }
    sib = sib.nextElementSibling;
  }

  // 2) Parent row — covers avatar + meta as siblings when #1 missed lines.
  if (lines.length < 2 && avatar.parentElement instanceof HTMLElement) {
    ingestBox(avatar.parentElement);
  }

  // 3) Climbed region fallback for deeply nested chrome.
  if (lines.length < 2) {
    const region = actorMetaRegion(avatar, scope);
    if (region) {
      ingestBox(region);
      for (const p of region.querySelectorAll("p")) {
        if (!(p instanceof HTMLElement)) continue;
        if (avatar.contains(p)) continue;
        if (isInsideActivityHeader(p)) continue;
        if (p.querySelector("p") || isSrOnlyDuplicate(p)) continue;
        push(paragraphVisibleText(p));
      }
    }
  }

  return lines;
}

function paragraphVisibleText(p: HTMLElement): string {
  return cleanInvisible(
    textOf(
      p.querySelector(':scope > span[aria-hidden="true"]') ??
        p.querySelector('span[aria-hidden="true"]') ??
        p,
    ),
  );
}

/**
 * Smallest wrapper around the author avatar that also contains the meta lines.
 * Climbs from the avatar — does not stop on the name-only profile `<a>`.
 */
function actorMetaRegion(
  avatar: HTMLElement,
  scope: HTMLElement,
): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  let current: HTMLElement | null = avatar.parentElement;

  for (let i = 0; i < 5 && current && scope.contains(current); i += 1) {
    const count = countAuthorParas(current, avatar);
    if (count >= 2) return current;
    if (count >= 1 && !fallback) fallback = current;
    if (current === scope) break;
    current = current.parentElement;
  }

  // Parent of avatar is usually the row; prefer it over a name-only sibling.
  if (avatar.parentElement instanceof HTMLElement) {
    return avatar.parentElement;
  }
  return fallback;
}

function countAuthorParas(container: HTMLElement, avatar: HTMLElement): number {
  let n = 0;
  for (const p of container.querySelectorAll("p")) {
    if (!(p instanceof HTMLElement)) continue;
    if (avatar.contains(p)) continue;
    if (p.querySelector("p")) continue;
    if (isSrOnlyDuplicate(p)) continue;
    if (paragraphVisibleText(p)) n += 1;
  }
  return n;
}

/**
 * Last-resort headline hunt inside author chrome: first non-name, non-noise
 * paragraph (or visible aria-hidden span) after the avatar.
 */
function scanActorHeadline(
  scope: HTMLElement,
  authorName: string | undefined,
): string | undefined {
  const avatar = postAuthorAvatar(scope);
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const headline = cleanHeadline(raw);
    if (!headline) return;
    if (authorName && headline.toLowerCase() === authorName) return;
    const key = headline.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(headline);
  };

  const followsAvatar = (el: Element): boolean => {
    if (!(avatar instanceof HTMLElement)) return true;
    if (avatar.contains(el)) return false;
    if (isInsideActivityHeader(el as HTMLElement)) return false;
    const pos = avatar.compareDocumentPosition(el);
    if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return true;
    if ((pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return false;
    // Fallback for incomplete DOM implementations: under a next sibling.
    let sib = avatar.nextElementSibling;
    while (sib) {
      if (sib === el || sib.contains(el)) return true;
      sib = sib.nextElementSibling;
    }
    return false;
  };

  for (const p of scope.querySelectorAll("p")) {
    if (!(p instanceof HTMLElement)) continue;
    if (isInsideActivityHeader(p)) continue;
    if (p.querySelector("p")) continue;
    if (isSrOnlyDuplicate(p)) continue;
    if (!followsAvatar(p)) continue;
    push(paragraphVisibleText(p));
  }

  // Some SDUI builds render name/headline as spans without <p> wrappers.
  if (candidates.length < 2) {
    for (const span of scope.querySelectorAll('span[aria-hidden="true"]')) {
      if (!(span instanceof HTMLElement)) continue;
      if (isInsideActivityHeader(span)) continue;
      if (span.closest("p")) continue; // already covered via paragraphVisibleText
      if (!followsAvatar(span)) continue;
      const text = cleanInvisible(textOf(span));
      // Skip tiny UI glyphs / single-letter affordances.
      if (!text || text.length < 3) continue;
      push(text);
    }
  }

  if (authorName) {
    return candidates.find((c) => c.toLowerCase() !== authorName);
  }
  // Without a known name, the first candidate is usually the name — take the 2nd.
  return candidates[1];
}

/** LinkedIn often emits a second visually-hidden <p> that duplicates the name. */
function isSrOnlyDuplicate(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const cls = typeof el.className === "string" ? el.className : "";
  if (/\bvisually-hidden\b|\bsr-only\b|clip-sr/i.test(cls)) return true;
  // Paragraph that only contains visually-hidden children (no visible aria-hidden span).
  if (
    !el.querySelector(':scope > span[aria-hidden="true"]') &&
    el.querySelector(
      ':scope > .visually-hidden, :scope > [class*="visually-hidden"]',
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Post author region — never the activity strip ("X commented" / "Suggested").
 * Prefer a tight wrapper around the real author avatar below that strip.
 */
function actorRoot(card: HTMLElement): HTMLElement {
  const root = extractionRoot(card);

  for (const sel of [".update-components-actor", ".feed-shared-actor"]) {
    const actor = root.querySelector(sel);
    if (actor instanceof HTMLElement && !isInsideActivityHeader(actor)) {
      return actor;
    }
  }

  const avatar = postAuthorAvatar(root);
  if (!avatar) return root;

  let best: HTMLElement =
    avatar.parentElement instanceof HTMLElement ? avatar.parentElement : avatar;
  let current: HTMLElement = avatar;

  for (let i = 0; i < 6; i += 1) {
    const next = current.parentElement;
    if (!(next instanceof HTMLElement) || next === root) break;
    // Don't expand into a parent that also owns the activity header strip.
    if (parentContainsSeparateActivityHeader(next, avatar)) break;
    current = next;
    if (
      current.querySelectorAll('a[href*="/in/"]').length >= 1 &&
      current.querySelector("p, span")
    ) {
      best = current;
    }
  }

  return best;
}

/**
 * Real post author avatar — skips the small activity-header face
 * ("Greg Tomasik commented"). When several match, prefer the last one
 * (main author sits below the strip).
 */
function postAuthorAvatar(root: HTMLElement): HTMLElement | null {
  const all = [
    ...root.querySelectorAll('[data-view-name="feed-actor-image"]'),
  ].filter((el): el is HTMLElement => el instanceof HTMLElement);

  const candidates = all.filter((el) => !isInsideActivityHeader(el));
  if (candidates.length > 0) return candidates[candidates.length - 1] ?? null;
  // Last resort: last avatar on the card (below the header).
  return all.length > 0 ? (all[all.length - 1] ?? null) : null;
}

function isInsideActivityHeader(el: HTMLElement): boolean {
  if (
    el.closest(
      '[data-view-name*="feed-header"], [data-view-name="feed-header-text"], [data-view-name="feed-header-actor-image"]',
    )
  ) {
    return true;
  }

  let current: HTMLElement | null = el;
  for (let i = 0; i < 6 && current; i += 1) {
    if (isActivityHeaderContainer(current)) return true;
    // Stop at the post body / card — those aren't header strips.
    if (
      current.getAttribute("data-view-name") === "feed-full-update" ||
      current.getAttribute("role") === "listitem" ||
      current.querySelector(
        '[data-view-name="feed-commentary"], [data-testid="expandable-text-box"]',
      )
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}

function isActivityHeaderContainer(el: HTMLElement): boolean {
  const view = el.getAttribute("data-view-name") ?? "";
  if (/feed-header/i.test(view)) return true;
  if (
    el.querySelector(
      '[data-view-name="feed-header-text"], [data-view-name="feed-header-actor-image"], [data-view-name="feed-header"]',
    )
  ) {
    // Header chrome only when it does not also wrap the main author + body.
    if (
      !el.querySelector(
        '[data-view-name="feed-commentary"], [data-testid="expandable-text-box"]',
      )
    ) {
      return true;
    }
  }

  // Compact strip whose visible copy is an activity phrase.
  // Exclude containers that also hold the post commentary.
  if (
    el.querySelector(
      '[data-view-name="feed-commentary"], [data-testid="expandable-text-box"]',
    )
  ) {
    return false;
  }

  const labeled = textOf(
    el.querySelector('[data-view-name="feed-header-text"]') ?? el,
  );
  const t = cleanInvisible(labeled);
  if (t && t.length <= 100 && isActivityHeaderPhrase(t)) return true;

  return false;
}

function parentContainsSeparateActivityHeader(
  parent: HTMLElement,
  authorAvatar: HTMLElement,
): boolean {
  for (const child of parent.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.contains(authorAvatar)) continue;
    if (isActivityHeaderContainer(child)) return true;
  }
  return false;
}

function extractAuthorProfileUrl(card: HTMLElement): string | undefined {
  const root = extractionRoot(card);
  const avatar = postAuthorAvatar(root);

  if (avatar instanceof HTMLAnchorElement) {
    const fromAvatar = normalizeLinkedInProfileUrl(avatar.href);
    if (fromAvatar) return fromAvatar;
  }

  if (avatar instanceof HTMLElement) {
    const nested = avatar.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
    const fromNested = nested?.href
      ? normalizeLinkedInProfileUrl(nested.href)
      : undefined;
    if (fromNested) return fromNested;

    // Name/meta link is typically the next sibling (or inside the next sibling).
    let sib = avatar.nextElementSibling;
    for (let i = 0; i < 3 && sib; i += 1) {
      if (sib instanceof HTMLAnchorElement && sib.href.includes("/in/")) {
        const fromSib = normalizeLinkedInProfileUrl(sib.href);
        if (fromSib) return fromSib;
      }
      if (sib instanceof HTMLElement) {
        const inner = sib.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
        const fromInner = inner?.href
          ? normalizeLinkedInProfileUrl(inner.href)
          : undefined;
        if (fromInner) return fromInner;
      }
      sib = sib.nextElementSibling;
    }
  }

  const scope = actorRoot(card);
  const selectors = [
    'a[data-view-name="feed-actor-image"][href*="/in/"]',
    '[data-view-name="feed-actor-image"] a[href*="/in/"]',
    '[data-view-name="feed-actor-image"] + a[href*="/in/"]',
    ".update-components-actor__meta-link",
    ".feed-shared-actor__meta-link",
    ".update-components-actor__image-link",
  ];

  for (const sel of selectors) {
    const anchor = scope.querySelector<HTMLAnchorElement>(sel);
    if (!anchor || isInsideActivityHeader(anchor)) continue;
    const normalized = normalizeLinkedInProfileUrl(anchor.href);
    if (normalized) return normalized;
  }

  for (const anchor of scope.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/in/"]',
  )) {
    if (isInsideActivityHeader(anchor)) continue;
    const normalized = normalizeLinkedInProfileUrl(anchor.href);
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

  // Author region only — never the activity strip (`X commented` / feed-header).
  let scope: HTMLElement = root;
  const avatar = postAuthorAvatar(root);
  const actor =
    root.querySelector(".update-components-actor, .feed-shared-actor") ??
    (avatar?.parentElement instanceof HTMLElement ? avatar.parentElement : null);
  if (actor instanceof HTMLElement && !isInsideActivityHeader(actor)) {
    scope = actor;
  } else if (avatar?.parentElement instanceof HTMLElement) {
    scope = avatar.parentElement;
  }
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
 * Reaction / comment counts from the social-proof row.
 *
 * Modern LinkedIn often renders the reaction total as a bare number next to
 * emoji icons ("43"), with comments/reposts as "1 comment • 5 reposts" in a
 * sibling control — no "reactions" label and often no `feed-reaction-count`.
 */
function extractReactions(card: HTMLElement): string | undefined {
  const root = extractionRoot(card);

  const nodes = root.querySelectorAll(
    [
      '[data-view-name="feed-reaction-count"]',
      '[data-view-name*="reaction-count"]',
      ".social-details-social-counts__reactions-count",
      ".social-details-social-counts__reactions",
      'button[aria-label*="reaction" i]',
      '[aria-label*="reaction" i]',
      'button[aria-label*=" others" i]',
    ].join(", "),
  );

  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    if (isSocialActionControl(el)) continue;

    const fromAria = countFromReactionAria(el.getAttribute("aria-label"));
    if (fromAria) return fromAria;

    const text = cleanInvisible(textOf(el));
    if (!text) continue;

    const explicit = text.match(/([\d,.]+[KkMm]?)\s*reactions?\b/i);
    if (explicit?.[1]) return explicit[1];

    // Dedicated reaction node with a bare count ("43").
    if (isBareCount(text) && !/comment|repost|share/i.test(text)) {
      return text;
    }
  }

  return countsFromSocialProof(root).reactions;
}

/** e.g. "42 reactions", "Jane and 41 others", "Open reactions list: 12 reactions" */
function countFromReactionAria(aria: string | null): string | undefined {
  if (!aria) return undefined;
  const reactions = aria.match(/([\d,.]+[KkMm]?)\s*reactions?\b/i);
  if (reactions?.[1]) return reactions[1];
  // "Open reactions list" / "See who reacted" — no usable count.
  if (/react/i.test(aria) && !/[\d,.]+/.test(aria)) return undefined;
  const others = aria.match(/(?:and|&)\s*([\d,.]+[KkMm]?)\s*others?\b/i);
  if (others?.[1]) return others[1];
  // Rare: aria is just the number on the reactions control.
  if (isBareCount(aria)) return aria.trim();
  return undefined;
}

function extractComments(card: HTMLElement): string | undefined {
  const root = extractionRoot(card);

  const nodes = root.querySelectorAll(
    [
      '[data-view-name="feed-comment-count"]',
      '[data-view-name*="comment-count"]',
      ".social-details-social-counts__comments",
      'button[aria-label*="comment" i]',
      '[aria-label*="comment" i]',
      'a[aria-label*="comment" i]',
    ].join(", "),
  );

  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    if (isSocialActionControl(el)) continue;

    const aria = el.getAttribute("aria-label") ?? "";
    const fromAria = aria.match(/([\d,.]+[KkMm]?)\s*comments?\b/i);
    if (fromAria?.[1]) return fromAria[1];

    const text = cleanInvisible(textOf(el));
    if (!text) continue;

    // "1 comment • 5 reposts" — extract comments even when reposts share the node.
    const fromText = text.match(/([\d,.]+[KkMm]?)\s*comments?\b/i);
    if (fromText?.[1]) return fromText[1];

    if (
      el.matches(
        '[data-view-name="feed-comment-count"], [data-view-name*="comment-count"], .social-details-social-counts__comments',
      ) &&
      isBareCount(text)
    ) {
      return text;
    }
  }

  return countsFromSocialProof(root).comments;
}

/**
 * Parse the social-proof strip above Like/Comment/Repost.
 * Typical layout: [👍❤️ 43]   [1 comment • 5 reposts]
 */
function countsFromSocialProof(root: HTMLElement): {
  reactions?: string;
  comments?: string;
} {
  const scope = socialProofScope(root);
  const texts: string[] = [];
  const bareCounts: string[] = [];

  for (const el of scope.querySelectorAll("button, a, span, p, div")) {
    if (!(el instanceof HTMLElement)) continue;
    if (isSocialActionControl(el)) continue;
    if (isSocialActionBar(el)) continue;

    const aria = el.getAttribute("aria-label") ?? "";
    const text = cleanInvisible(textOf(el));
    if (!text || text.length > 80) continue;

    // Skip nested wrappers once we've already seen the same leaf text.
    if (el.children.length > 3 && text.length > 24) continue;

    const looksSocial =
      isBareCount(text) ||
      /comments?|reactions?|reposts?|others/i.test(text) ||
      /comments?|reactions?|reposts?|others/i.test(aria);
    if (!looksSocial) continue;

    texts.push(text);

    if (isBareCount(text)) {
      // Don't treat the comment/repost chip's number as reactions.
      if (/comment|repost|share/i.test(aria)) continue;
      if (el.closest('[data-view-name*="comment"], [data-view-name*="repost"]')) {
        continue;
      }
      // Parent text like "1 comment" means this bare "1" is not reactions.
      const parentText = cleanInvisible(textOf(el.parentElement));
      if (/comments?|reposts?|shares?/i.test(parentText) && parentText.length < 60) {
        continue;
      }
      bareCounts.push(text);
    }
  }

  let reactions: string | undefined;
  let comments: string | undefined;
  let reposts: string | undefined;

  for (const text of texts) {
    if (!reactions) {
      const labeled = text.match(/([\d,.]+[KkMm]?)\s*reactions?\b/i);
      if (labeled?.[1]) reactions = labeled[1];
    }
    if (!comments) {
      const labeled = text.match(/([\d,.]+[KkMm]?)\s*comments?\b/i);
      if (labeled?.[1]) comments = labeled[1];
    }
    if (!reposts) {
      const labeled = text.match(/([\d,.]+[KkMm]?)\s*reposts?\b/i);
      if (labeled?.[1]) reposts = labeled[1];
    }
  }

  const joined = texts.join(" · ");
  if (!comments) {
    const c = joined.match(/([\d,.]+[KkMm]?)\s*comments?\b/i);
    if (c?.[1]) comments = c[1];
  }
  if (!reposts) {
    const r = joined.match(/([\d,.]+[KkMm]?)\s*reposts?\b/i);
    if (r?.[1]) reposts = r[1];
  }
  if (!reactions) {
    const labeled = joined.match(/([\d,.]+[KkMm]?)\s*reactions?\b/i);
    if (labeled?.[1]) reactions = labeled[1];
  }

  // Bare number beside the icons — exclude known comment/repost totals.
  if (!reactions && bareCounts.length > 0) {
    const skip = new Set(
      [comments, reposts]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase()),
    );
    const candidate = bareCounts.find((n) => !skip.has(n.toLowerCase()));
    if (candidate) reactions = candidate;
  }

  // "43 · 1 comment • 5 reposts" — number preceding the comments clause.
  if (!reactions) {
    const beforeComments = joined.match(
      /(?:^|[•·|]\s*)([\d,.]+[KkMm]?)\s*[•·|]?\s*(?=[\d,.]+[KkMm]?\s*comments?)/i,
    );
    if (
      beforeComments?.[1] &&
      beforeComments[1].toLowerCase() !== comments?.toLowerCase()
    ) {
      reactions = beforeComments[1];
    }
  }

  return { reactions, comments };
}

/** Region that holds reaction icons + comment/repost chips (not the action bar). */
function socialProofScope(root: HTMLElement): HTMLElement {
  for (const sel of [
    ".social-details-social-counts",
    '[data-view-name*="social-count"]',
    '[data-view-name="feed-social-social-counts"]',
    '[data-view-name*="social-social-counts"]',
  ]) {
    const hit = root.querySelector(sel);
    if (hit instanceof HTMLElement && !isSocialActionBar(hit)) return hit;
  }

  const bar = root.querySelector(
    [
      '[data-view-name="feed-social-action-bar"]',
      ".feed-shared-social-action-bar",
      ".update-components-action-bar",
      '[data-view-name*="social-action"]',
    ].join(", "),
  );
  if (bar instanceof HTMLElement) {
    // Counts usually sit in the previous sibling of the action bar.
    const prev = bar.previousElementSibling;
    if (prev instanceof HTMLElement) return prev;
    const parent = bar.parentElement;
    if (parent instanceof HTMLElement) return parent;
  }

  return root;
}

function isBareCount(text: string): boolean {
  return /^[\d,.]+[KkMm]?$/i.test(cleanInvisible(text));
}

/** Like / Comment / Repost / Send controls — not the count chips above them. */
function isSocialActionControl(el: HTMLElement): boolean {
  if (el.closest('[data-view-name="feed-social-action-bar"], .feed-shared-social-action-bar, .update-components-action-bar, [data-view-name*="social-action"]')) {
    const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
    const text = cleanInvisible(textOf(el)).toLowerCase();
    // Action labels without a leading count.
    if (
      /^(?:like|unlike|unreact|comment|repost|share|send)(?:\s|$)/i.test(text) ||
      /^(?:like|unlike|unreact|comment|repost|share|send)\b/i.test(aria)
    ) {
      // Still allow "Comment (3)" / "3 comments" style labels.
      if (!/[\d,.]+/.test(aria) && !/[\d,.]+/.test(text)) return true;
      if (
        /^(?:like|unlike|unreact|comment|repost|share|send)$/i.test(aria) ||
        /^(?:like|unlike|unreact|comment|repost|share|send)$/i.test(text)
      ) {
        return true;
      }
    }
  }

  const aria = (el.getAttribute("aria-label") ?? "").trim();
  if (/^(?:like|comment|repost|share|send)$/i.test(aria)) return true;
  return false;
}

function isSocialActionBar(el: HTMLElement): boolean {
  return el.matches(
    [
      '[data-view-name="feed-social-action-bar"]',
      ".feed-shared-social-action-bar",
      ".update-components-action-bar",
      '[data-view-name*="social-action"]',
    ].join(", "),
  );
}

function extractUrl(card: HTMLElement): string | undefined {
  // Scope to the outer shell — same as reactions/comments/age — since the
  // permalink anchor (when LinkedIn renders one) often lives above the
  // inner `feed-full-update` node we're handed.
  const root = extractionRoot(card);

  const anchor = root.querySelector<HTMLAnchorElement>(
    [
      'a[href*="/feed/update/"]',
      'a[href*="/posts/"]',
      'a[href*="urn:li:activity"]',
      ".update-components-actor__sub-description-link",
      ".feed-shared-actor__sub-description-link",
    ].join(", "),
  );
  if (anchor?.href) return anchor.href;

  // LinkedIn's SDUI feed often has no real anchor for "copy link to post" —
  // it's built client-side from the URN. Reconstruct it the same way from
  // data-urn / data-id / componentkey, mirroring `collectSnowflakeIds`.
  const urn = extractPostUrn(root);
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined;
}

/** Raw update URN (activity / ugcPost / share) used to rebuild a permalink. */
function extractPostUrn(root: HTMLElement): string | undefined {
  const attrs = ["data-urn", "data-id", "componentkey"];
  const urnPattern = /urn:li:(?:activity|ugcPost|share):\d{15,22}/i;

  const fromAttr = (el: Element): string | undefined => {
    for (const attr of attrs) {
      const match = el.getAttribute(attr)?.match(urnPattern);
      if (match) return match[0];
    }
    return undefined;
  };

  const own = fromAttr(root);
  if (own) return own;

  for (const el of root.querySelectorAll("[data-urn], [data-id], [componentkey]")) {
    const found = fromAttr(el);
    if (found) return found;
  }

  return undefined;
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
