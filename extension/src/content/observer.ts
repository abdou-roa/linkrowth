/**
 * Visibility gate: fire when a feed card is ~100% in the viewport.
 * Selectors are LinkedIn-fragile and will need fixtures / retuning.
 */

const CARD_SELECTORS = [
  "div.feed-shared-update-v2",
  "div.occludable-update",
  "article.feed-shared-update-v2",
].join(", ");

export type VisiblePostHandler = (card: HTMLElement) => void;

export function observeFullyVisiblePosts(onVisible: VisiblePostHandler): void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio < 1) continue;
        const card = entry.target as HTMLElement;
        onVisible(card);
      }
    },
    { threshold: 1 },
  );

  const watch = (root: ParentNode = document) => {
    root.querySelectorAll<HTMLElement>(CARD_SELECTORS).forEach((card) => {
      if (card.dataset.linkrowthObserved === "1") return;
      card.dataset.linkrowthObserved = "1";
      observer.observe(card);
    });
  };

  watch();

  const mutation = new MutationObserver(() => watch());
  mutation.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
