import type { TriageStatus } from "../shared/types";
import { STATUS_LABEL, scoreTier } from "../shared/labels";

/** Statuses that stay as a visible feed badge. Skip/fail/queued remove the chip. */
const VISIBLE_ON_FEED: ReadonlySet<TriageStatus> = new Set([
  "roasting",
  "worth_it",
]);

const CONTROL_MENU_SELECTORS = [
  'button[aria-label*="control menu" i]',
  'button[aria-label*="Open control menu" i]',
].join(", ");

export function setBadge(
  card: HTMLElement,
  status: TriageStatus,
  opts?: { score?: number },
): void {
  if (!VISIBLE_ON_FEED.has(status)) {
    removeBadge(card);
    return;
  }

  let badge = card.querySelector<HTMLElement>(".linkrowth-badge");
  // Badge may live on the outer listitem (beside ···), not on the observed card.
  if (!badge) {
    badge = badgeRoot(card).querySelector<HTMLElement>(".linkrowth-badge");
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "linkrowth-badge";
    badge.setAttribute("role", "status");
    mountBadge(card, badge);
  } else if (!badge.classList.contains("linkrowth-badge--beside-menu")) {
    // Menu may have hydrated after a corner fallback — re-anchor next to ···.
    if (findControlMenu(badgeRoot(card))) mountBadge(card, badge);
  }

  badge.dataset.status = status;
  badge.textContent = formatBadgeLabel(status, opts);
}

export function removeBadge(card: HTMLElement): void {
  badgeRoot(card).querySelector(".linkrowth-badge")?.remove();
}

/**
 * Prefer sitting immediately left of LinkedIn's ··· control menu.
 * Absolute top-right overlaps that button on modern feed cards.
 *
 * The menu often lives on the outer listitem while we observe an inner
 * `feed-full-update` — search the outer shell too.
 */
function mountBadge(card: HTMLElement, badge: HTMLElement): void {
  const root = badgeRoot(card);
  const control = findControlMenu(root);
  const host = control?.parentElement;
  if (control && host) {
    badge.classList.add("linkrowth-badge--beside-menu");
    badge.classList.remove("linkrowth-badge--corner");
    if (badge.parentElement !== host || badge.nextElementSibling !== control) {
      host.insertBefore(badge, control);
    }
    return;
  }

  badge.classList.add("linkrowth-badge--corner");
  badge.classList.remove("linkrowth-badge--beside-menu");
  const style = getComputedStyle(card);
  if (style.position === "static") {
    card.style.position = "relative";
  }
  if (badge.parentElement !== card) {
    card.appendChild(badge);
  }
}

/** Outer feed shell when present — where the ··· menu usually lives. */
function badgeRoot(card: HTMLElement): HTMLElement {
  const outer = card.closest(
    'div[role="listitem"][componentkey*="FeedType"], article[data-id="main-feed-card"]',
  );
  return outer instanceof HTMLElement ? outer : card;
}

function findControlMenu(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(CONTROL_MENU_SELECTORS);
}

function formatBadgeLabel(
  status: TriageStatus,
  opts?: { score?: number },
): string {
  const label = STATUS_LABEL[status];
  if (status !== "worth_it") return label;

  if (typeof opts?.score === "number") {
    const short: Record<string, string> = {
      high: "High",
      medium: "Med",
      low: "Low",
    };
    return `${label} · ${short[scoreTier(opts.score)]}`;
  }
  return label;
}

/** Brief highlight when the side panel jumps to this card. */
export function flashCard(card: HTMLElement): void {
  card.classList.remove("linkrowth-flash");
  // Force reflow so re-adding the class retriggers the animation.
  void card.offsetWidth;
  card.classList.add("linkrowth-flash");
  window.setTimeout(() => card.classList.remove("linkrowth-flash"), 1600);
}
