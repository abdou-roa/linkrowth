import type { TriageStatus } from "../shared/types";
import { STATUS_LABEL, scoreTier } from "../shared/labels";

/** Statuses that stay as a visible feed badge. Skip/fail/queued remove the chip. */
const VISIBLE_ON_FEED: ReadonlySet<TriageStatus> = new Set([
  "roasting",
  "worth_it",
]);

export function setBadge(
  card: HTMLElement,
  status: TriageStatus,
  opts?: { score?: number },
): void {
  if (!VISIBLE_ON_FEED.has(status)) {
    removeBadge(card);
    return;
  }

  let badge = card.querySelector<HTMLElement>(":scope > .linkrowth-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "linkrowth-badge";
    badge.setAttribute("role", "status");
    const style = getComputedStyle(card);
    if (style.position === "static") {
      card.style.position = "relative";
    }
    card.appendChild(badge);
  }

  badge.dataset.status = status;
  badge.textContent = formatBadgeLabel(status, opts);
}

export function removeBadge(card: HTMLElement): void {
  card.querySelector(":scope > .linkrowth-badge")?.remove();
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
