import type { TriageStatus } from "../shared/types";

const LABEL: Record<TriageStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  roasting: "Roasting…",
  worth_it: "Worth it",
  not_worth_it: "Not worth it",
  failed: "Couldn’t score",
};

export function setBadge(card: HTMLElement, status: TriageStatus): void {
  let badge = card.querySelector<HTMLElement>(".linkrowth-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "linkrowth-badge";
    card.style.position = card.style.position || "relative";
    card.appendChild(badge);
  }

  badge.dataset.status = status;
  badge.textContent = LABEL[status];
}
