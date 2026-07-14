import { MessageType, isExtensionMessage } from "../shared/messages";
import type { TriageEntry } from "../shared/types";

const listEl = document.getElementById("list") as HTMLUListElement;
const emptyEl = document.getElementById("empty") as HTMLParagraphElement;
const hideSkipsEl = document.getElementById("hide-skips") as HTMLInputElement;
const refreshEl = document.getElementById("refresh") as HTMLButtonElement;

let entries: TriageEntry[] = [];

async function refresh(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.LIST_TRIAGE,
  });
  if (response?.type === MessageType.LIST_TRIAGE_RESULT) {
    entries = response.entries ?? [];
    render();
  }
}

function render(): void {
  const hideSkips = hideSkipsEl.checked;
  const visible = entries.filter((e) => {
    if (hideSkips && e.triage.status === "not_worth_it") return false;
    return true;
  });

  listEl.innerHTML = "";
  emptyEl.hidden = visible.length > 0;

  for (const entry of visible) {
    const li = document.createElement("li");
    li.className = "row";

    const likes = entry.post.metrics.likes ?? "—";
    const comments = entry.post.metrics.commentsCount ?? "—";
    const statusClass = `status-${entry.triage.status}`;

    li.innerHTML = `
      <div class="row-meta">
        <span class="${statusClass}">${labelFor(entry.triage.status)}</span>
        <span>score ${entry.triage.score} · likes ${likes} · comments ${comments}</span>
      </div>
      <p class="snippet"></p>
      <p class="reasons"></p>
    `;
    li.querySelector(".snippet")!.textContent = entry.post.text || "(no text)";
    li.querySelector(".reasons")!.textContent =
      entry.triage.reasons.join(" · ") ||
      entry.triage.error ||
      "";

    listEl.appendChild(li);
  }
}

function labelFor(status: string): string {
  switch (status) {
    case "worth_it":
      return "Worth it";
    case "not_worth_it":
      return "Not worth it";
    case "roasting":
      return "Roasting…";
    case "queued":
      return "Queued";
    case "failed":
      return "Couldn’t score";
    default:
      return status;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!isExtensionMessage(message)) return;
  if (message.type !== MessageType.TRIAGE_UPDATED) return;

  const idx = entries.findIndex((e) => e.post.id === message.entry.post.id);
  if (idx >= 0) entries[idx] = message.entry;
  else entries.push(message.entry);
  entries.sort((a, b) => {
    const rank = (s: string) => (s === "worth_it" ? 0 : s === "failed" ? 2 : 1);
    const byStatus = rank(a.triage.status) - rank(b.triage.status);
    if (byStatus !== 0) return byStatus;
    return b.triage.score - a.triage.score;
  });
  render();
});

hideSkipsEl.addEventListener("change", render);
refreshEl.addEventListener("click", () => void refresh());

void refresh();
