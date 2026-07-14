import type { TriageStatus } from "../shared/types";

const LABEL: Record<TriageStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  roasting: "Roasting…",
  worth_it: "Worth it",
  not_worth_it: "Not worth it",
  failed: "Couldn’t score",
};

export function setBadge(
  card: HTMLElement,
  status: TriageStatus,
  opts?: { score?: number; likes?: number },
): void {
  let badge = card.querySelector<HTMLElement>(":scope > .linkrowth-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "linkrowth-badge";
    // LinkedIn wrappers often need a positioning context
    const style = getComputedStyle(card);
    if (style.position === "static") {
      card.style.position = "relative";
    }
    card.appendChild(badge);
  }

  badge.dataset.status = status;
  badge.textContent = formatBadgeLabel(status, opts);
}

function formatBadgeLabel(
  status: TriageStatus,
  opts?: { score?: number; likes?: number },
): string {
  const label = LABEL[status];
  if (status !== "worth_it" && status !== "not_worth_it") return label;

  const parts = [label];
  if (typeof opts?.score === "number") parts.push(String(opts.score));
  if (typeof opts?.likes === "number") parts.push(`${opts.likes} likes`);
  return parts.join(" · ");
}
