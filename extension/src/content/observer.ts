/**
 * Visibility gate for organic feed post cards.
 * LinkedIn DOM variants change often — prefer data-* / view-name over hashed classes.
 *
 * Note: threshold === 1 is impractical for tall posts (taller than the viewport
 * never reaches 100% visible). We treat "mostly in view" as enough.
 */

/**
 * Organic post roots only.
 * Deliberately excludes generic wrappers (`occludable-update`, bare `FeedType`
 * listitems, `update-v2`) — those also match ads, PYMK, jobs, and sidebar chrome.
 */
const CARD_SELECTORS = [
  '[data-view-name="feed-full-update"]',
  'div[role="listitem"][componentkey*="FeedType_MAIN_FEED"]',
  'article[data-id="main-feed-card"]',
  "div.feed-shared-update-v2",
  "article.feed-shared-update-v2",
  'div[data-id^="urn:li:activity"]',
  'div[data-urn^="urn:li:activity"]',
  'div[data-urn^="urn:li:ugcPost"]',
  'div[data-urn^="urn:li:share"]',
  'div[data-urn^="urn:li:aggregatedShare"]',
].join(", ");

/** Prefer the center feed column so aside/nav cards never enter the pipeline. */
const FEED_ROOT_SELECTORS = [
  ".scaffold-layout__main",
  "main .scaffold-finite-scroll__content",
  "main",
].join(", ");

/** Minimum intersection ratio to enter the triage pipeline. */
const VISIBLE_RATIO = 0.45;

export type VisiblePostHandler = (card: HTMLElement) => void;

export function observeFullyVisiblePosts(onVisible: VisiblePostHandler): void {
  const fired = new WeakSet<Element>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.intersectionRatio < VISIBLE_RATIO) continue;
        const card = resolveCard(entry.target as HTMLElement);
        if (!isOrganicFeedPost(card)) continue;
        if (fired.has(card)) continue;
        fired.add(card);
        onVisible(card);
      }
    },
    { threshold: [0, 0.25, 0.45, 0.5, 0.75, 1] },
  );

  const watch = () => {
    const roots = feedRoots();
    let matched = 0;
    let newlyWatched = 0;
    let skipped = 0;
    let waiting = 0;

    for (const root of roots) {
      const nodes = root.querySelectorAll<HTMLElement>(CARD_SELECTORS);
      matched += nodes.length;

      nodes.forEach((node) => {
        const card = resolveCard(node);
        if (card.dataset.linkrowthObserved === "1") return;
        if (card.dataset.linkrowthSkipped === "1") return;

        const verdict = classifyCard(card);
        if (verdict === "ok") {
          card.dataset.linkrowthObserved = "1";
          observer.observe(card);
          newlyWatched += 1;
          return;
        }

        // Soft rejects (action bar not hydrated yet) must be rechecked — do not
        // permanently skip or organic posts never get watched.
        if (verdict === "pending") {
          waiting += 1;
          return;
        }

        card.dataset.linkrowthSkipped = "1";
        skipped += 1;
      });
    }

    if (newlyWatched > 0 || skipped > 0 || waiting > 0) {
      console.log(
        "%c🔗 Linkrowth",
        "font-weight:bold",
        `— watching ${newlyWatched} post(s); skipped ${skipped}; waiting ${waiting}; ${matched} selector hit(s) 👀`,
      );
    }
  };

  watch();

  let scheduled = false;
  const mutation = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      watch();
    }, 200);
  });
  mutation.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function feedRoots(): ParentNode[] {
  const found = document.querySelectorAll<HTMLElement>(FEED_ROOT_SELECTORS);
  if (found.length > 0) return Array.from(found);
  return [document];
}

/** Collapse nested matches to the outermost / most stable post wrapper. */
function resolveCard(el: HTMLElement): HTMLElement {
  const candidates = [
    el.closest('[data-view-name="feed-full-update"]'),
    el.closest('div[role="listitem"][componentkey*="FeedType_MAIN_FEED"]'),
    el.closest('article[data-id="main-feed-card"]'),
    el.closest('div[data-id^="urn:li:activity"]'),
    el.closest('div[data-urn^="urn:li:activity"]'),
    el.closest('div[data-urn^="urn:li:ugcPost"]'),
    el.closest("div.feed-shared-update-v2, article.feed-shared-update-v2"),
  ];

  for (const c of candidates) {
    if (c instanceof HTMLElement) return c;
  }
  return el;
}

type CardVerdict = "ok" | "pending" | "not-update" | "non-post" | "promoted";

/**
 * Classify a matched node before observing it.
 * `pending` = weak shell without engage controls yet (retry later).
 */
function classifyCard(card: HTMLElement): CardVerdict {
  if (!looksLikeUpdateCard(card)) return "not-update";
  if (hasJunkModule(card)) return "non-post";
  if (isPromotedCard(card)) return "promoted";

  // Strong organic shells are enough — LinkedIn often hashes or localizes
  // action-bar markup, so a hard require false-negatives every post.
  if (
    isStrongPostShell(card) ||
    hasSocialActionBar(card) ||
    hasActorProfileLink(card)
  ) {
    return "ok";
  }

  return "pending";
}

function isOrganicFeedPost(card: HTMLElement): boolean {
  return classifyCard(card) === "ok";
}

function isStrongPostShell(card: HTMLElement): boolean {
  return (
    card.matches('[data-view-name="feed-full-update"]') ||
    card.matches('article[data-id="main-feed-card"]') ||
    card.matches("div.feed-shared-update-v2, article.feed-shared-update-v2") ||
    card.matches(
      '[data-id^="urn:li:activity"], [data-urn^="urn:li:activity"], [data-urn^="urn:li:ugcPost"], [data-urn^="urn:li:share"], [data-urn^="urn:li:aggregatedShare"]',
    ) ||
    Boolean(card.querySelector('[data-view-name="feed-full-update"]'))
  );
}

function looksLikeUpdateCard(card: HTMLElement): boolean {
  if (card.matches('[data-view-name="feed-full-update"]')) return true;
  if (card.matches('article[data-id="main-feed-card"]')) return true;
  if (
    card.matches(
      "div.feed-shared-update-v2, article.feed-shared-update-v2",
    )
  ) {
    return true;
  }
  if (
    card.matches(
      '[data-id^="urn:li:activity"], [data-urn^="urn:li:activity"], [data-urn^="urn:li:ugcPost"], [data-urn^="urn:li:share"], [data-urn^="urn:li:aggregatedShare"]',
    )
  ) {
    return true;
  }

  const key = card.getAttribute("componentkey") ?? "";
  if (/FeedType_MAIN_FEED/i.test(key)) return true;

  // Nested shells sometimes wrap the true update without matching above.
  if (card.querySelector('[data-view-name="feed-full-update"]')) return true;
  if (card.querySelector("div.feed-shared-update-v2, article.feed-shared-update-v2")) {
    return true;
  }

  return false;
}

/** Explicit non-post feed modules (PYMK, discovery, news carousels). */
function hasJunkModule(card: HTMLElement): boolean {
  const junkSelectors = [
    '[data-view-name="feed-pymk"]',
    ".feed-shared-pymk",
    '[data-view-name="feed-discovery-entity"]',
    ".discover-entity-list",
    ".feed-follows-module",
    ".feed-shared-news-module",
    ".feed-shared-article-recommendation",
  ].join(", ");

  return Boolean(card.querySelector(junkSelectors));
}

/**
 * Social action bar / engage controls.
 * Prefer stable attrs + aria labels — hashed class names often won't match.
 */
/** Author profile in the actor chrome — useful when the action bar is not hydrated yet. */
function hasActorProfileLink(card: HTMLElement): boolean {
  const actor = card.querySelector(
    [
      ".update-components-actor",
      ".feed-shared-actor",
      '[data-view-name="feed-actor-image"]',
    ].join(", "),
  );
  if (!(actor instanceof HTMLElement)) return false;

  const scope =
    actor.getAttribute("data-view-name") === "feed-actor-image"
      ? actor.parentElement instanceof HTMLElement
        ? actor.parentElement
        : actor
      : actor;

  return Boolean(
    scope.querySelector(
      [
        'a[data-view-name="feed-actor-image"][href*="/in/"]',
        '[data-view-name="feed-actor-image"] a[href*="/in/"]',
        '[data-view-name="feed-actor-image"] + a[href*="/in/"]',
        ".update-components-actor__meta-link",
        ".feed-shared-actor__meta-link",
        'a[href*="/in/"]',
      ].join(", "),
    ),
  );
}

function hasSocialActionBar(card: HTMLElement): boolean {
  return Boolean(
    card.querySelector(
      [
        ".update-components-action-bar",
        ".feed-shared-social-action-bar",
        '[data-view-name="feed-social-action-bar"]',
        '[data-view-name*="social-action"]',
        'button[aria-label*="Like" i]',
        'button[aria-label*="React" i]',
        'button[aria-label*="Comment" i]',
        'button[aria-label*="Open reactions" i]',
      ].join(", "),
    ),
  );
}

/**
 * Detect sponsored / promoted cards, including obfuscated "Promoted" labels
 * nested in spans (exact match only to avoid "Promoted to Manager" false hits).
 *
 * Sponsored tracking attrs are checked on the card root + depth-1 children
 * only — LinkedIn embeds the same attrs deep inside organic posts, and a
 * full-subtree scan false-positives every update.
 */
function isPromotedCard(card: HTMLElement): boolean {
  if (hasPromotedRootAttr(card)) return true;

  for (const child of card.children) {
    if (child instanceof HTMLElement && hasPromotedRootAttr(child)) return true;
  }

  if (card.querySelector('[data-view-name="feed-actor-sponsored"]')) return true;

  if (
    card.querySelector(
      ".feed-shared-actor__sub-description--sponsored, .update-components-actor__sponsored",
    )
  ) {
    return true;
  }

  const identity =
    card.getAttribute("componentkey") ||
    card.getAttribute("data-id") ||
    card.getAttribute("data-urn") ||
    "";
  if (/sponsor|promoted|ads?loyalty|\bpromo\b/i.test(identity)) return true;

  if (hasObfuscatedPromotedLabel(card)) return true;

  // The badge often sits on the outer listitem, above `feed-full-update`.
  const outer = card.closest(
    'div[role="listitem"][componentkey*="FeedType"], article[data-id="main-feed-card"]',
  );
  if (
    outer instanceof HTMLElement &&
    outer !== card &&
    hasObfuscatedPromotedLabel(outer)
  ) {
    return true;
  }

  return false;
}

/**
 * LinkedIn 2026+ renders the badge with hashed classes and a UUID componentkey:
 *   <p componentkey="…" ><span>Promoted</span></p>
 * No stable class / data-view-name — only the exact label text is reliable.
 */
function hasObfuscatedPromotedLabel(card: HTMLElement): boolean {
  for (const p of card.querySelectorAll("p[componentkey]")) {
    if (isExactPromoLabel(p.textContent)) return true;
  }

  // Same badge as a leaf span inside actor chrome / legacy sub-description.
  const scoped = card.querySelectorAll(
    [
      '[data-view-name*="feed-actor"] span',
      '[data-view-name*="actor"] span',
      ".update-components-actor__sub-description span",
      ".feed-shared-actor__sub-description span",
      "p[componentkey] span",
    ].join(", "),
  );

  for (const span of scoped) {
    // Leaf only — parent <p> already checked; skip wrappers that nest more markup.
    if (span.children.length > 0) continue;
    if (isExactPromoLabel(span.textContent)) return true;
  }

  return false;
}

function isExactPromoLabel(raw: string | null | undefined): boolean {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return text === "promoted" || text === "sponsored";
}

function hasPromotedRootAttr(el: HTMLElement): boolean {
  return (
    el.hasAttribute("data-sponsored-tracking-url") ||
    el.hasAttribute("data-promoted-tracking-control-name")
  );
}
