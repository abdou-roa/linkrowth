/**
 * Visibility gate for feed cards.
 * LinkedIn DOM variants change often — prefer data-* / view-name over hashed classes.
 *
 * Note: threshold === 1 is impractical for tall posts (taller than the viewport
 * never reaches 100% visible). We treat "mostly in view" as enough.
 */

const CARD_SELECTORS = [
  '[data-view-name="feed-full-update"]',
  'div[role="listitem"][componentkey*="FeedType"]',
  'div.feed-shared-update-v2',
  'article.feed-shared-update-v2',
  'div[data-id^="urn:li:activity"]',
  'div[data-urn^="urn:li:activity"]',
  'div[data-urn^="urn:li:ugcPost"]',
  'div[data-urn^="urn:li:share"]',
  'div[data-urn^="urn:li:aggregatedShare"]',
  'div.update-components-update',
  'div.update-v2',
  'div.occludable-update',
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
        if (fired.has(card)) continue;
        fired.add(card);
        onVisible(card);
      }
    },
    { threshold: [0, 0.25, 0.45, 0.5, 0.75, 1] },
  );

  const watch = () => {
    const nodes = document.querySelectorAll<HTMLElement>(CARD_SELECTORS);
    let newlyWatched = 0;

    nodes.forEach((node) => {
      const card = resolveCard(node);
      if (card.dataset.linkrowthObserved === "1") return;
      card.dataset.linkrowthObserved = "1";
      observer.observe(card);
      newlyWatched += 1;
    });

    if (newlyWatched > 0) {
      console.log(
        "%c🔗 Linkrowth",
        "font-weight:bold",
        `— watching ${newlyWatched} new card(s); ${nodes.length} matched selector(s) 👀`,
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

/** Collapse nested matches to the outermost / most stable post wrapper. */
function resolveCard(el: HTMLElement): HTMLElement {
  const candidates = [
    el.closest('[data-view-name="feed-full-update"]'),
    el.closest('div[role="listitem"][componentkey*="FeedType"]'),
    el.closest('div[data-id^="urn:li:activity"]'),
    el.closest('div[data-urn^="urn:li:activity"]'),
    el.closest('div[data-urn^="urn:li:ugcPost"]'),
    el.closest("div.feed-shared-update-v2, article.feed-shared-update-v2"),
    el.closest("div.update-components-update, div.update-v2"),
    el.closest("div.occludable-update"),
  ];

  for (const c of candidates) {
    if (c instanceof HTMLElement) return c;
  }
  return el;
}
