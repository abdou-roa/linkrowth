import { MessageType, isExtensionMessage } from "../shared/messages";
import type { TriageEntry, TriageStatus } from "../shared/types";
import {
  displayScore,
  scoreTier,
  statusLabel,
  summarizeReasons,
  TIER_LABEL,
} from "../shared/labels";

console.log("%c🔗 Linkrowth", "font-weight:bold;font-size:12px", "— side panel open ✅");

const listEl = document.getElementById("list") as HTMLUListElement;
const emptyEl = document.getElementById("empty") as HTMLParagraphElement;
const summaryEl = document.getElementById("summary") as HTMLParagraphElement;
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
    if (hideSkips && e.triage.status === "failed") return false;
    return true;
  });

  listEl.innerHTML = "";
  emptyEl.hidden = visible.length > 0;
  renderSummary();

  for (const entry of visible) {
    listEl.appendChild(buildRow(entry));
  }
}

function renderSummary(): void {
  const scanned = entries.length;
  if (scanned === 0) {
    summaryEl.textContent = "";
    return;
  }

  const worth = entries.filter((e) => e.triage.status === "worth_it").length;
  const analyzing = entries.filter(
    (e) => e.triage.status === "queued" || e.triage.status === "roasting",
  ).length;

  const parts = [
    `${worth} worth engaging`,
    `${scanned} scanned`,
  ];
  if (analyzing > 0) parts.push(`${analyzing} analyzing`);
  summaryEl.textContent = parts.join(" · ");
}

function buildRow(entry: TriageEntry): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row";
  btn.dataset.postId = entry.post.id;

  const status = entry.triage.status as TriageStatus;
  const statusClass = `status-${status}`;
  const author = entry.post.author?.name?.trim() || "Unknown author";
  const score = displayScore(entry.triage.score);
  const tier = scoreTier(entry.triage.score);
  const showScore =
    status === "worth_it" || status === "not_worth_it";

  const meta = document.createElement("div");
  meta.className = "row-meta";

  const left = document.createElement("span");
  left.className = statusClass;
  left.textContent = statusLabel(status);
  meta.appendChild(left);

  if (showScore) {
    const scoreBlock = document.createElement("div");
    scoreBlock.className = "score-block";

    const scoreLabel = document.createElement("span");
    scoreLabel.className = "score-label";
    scoreLabel.textContent =
      status === "worth_it"
        ? TIER_LABEL[tier]
        : `Score ${score}`;

    const bar = document.createElement("div");
    bar.className = "score-bar";
    bar.dataset.tier = tier;
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuenow", String(score));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.title = `Score ${score} / 100`;

    const fill = document.createElement("span");
    fill.style.width = `${score}%`;
    bar.appendChild(fill);

    scoreBlock.append(scoreLabel, bar);
    meta.appendChild(scoreBlock);
  }

  const authorEl = document.createElement("p");
  authorEl.className = "row-author";
  authorEl.textContent = author;
  authorEl.title = author;

  const snippet = document.createElement("p");
  snippet.className = "snippet";
  snippet.textContent = entry.post.text || "(no text)";

  const reasons = document.createElement("p");
  reasons.className = "reasons";
  reasons.textContent = summarizeReasons(entry.triage.reasons, {
    status,
    error: entry.triage.error,
  });

  const hint = document.createElement("p");
  hint.className = "row-hint";
  hint.textContent = entry.post.url
    ? "Click to jump & generate comment"
    : "Post link unavailable";

  btn.append(meta, authorEl, snippet);
  if (reasons.textContent) btn.appendChild(reasons);
  btn.appendChild(hint);

  btn.addEventListener("click", () => {
    void focusPost(entry);
  });

  return btn;
}

async function focusPost(entry: TriageEntry): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*"] });
  const activeFirst = [...tabs].sort(
    (a, b) => Number(b.active) - Number(a.active),
  );

  for (const tab of activeFirst) {
    if (tab.id == null) continue;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: MessageType.FOCUS_POST,
        feedPostId: entry.post.id,
        url: entry.post.url,
      });
      if (result?.ok) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) {
          try {
            await chrome.windows.update(tab.windowId, { focused: true });
          } catch {
            // Focusing the window is best-effort.
          }
        }
        return;
      }
    } catch {
      // Content script not injected on this tab — try the next / fall through.
    }
  }

  if (entry.post.url) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: ["https://www.linkedin.com/*"],
    });
    if (tab?.id != null) {
      await chrome.tabs.update(tab.id, { url: entry.post.url });
      return;
    }
    await chrome.tabs.create({ url: entry.post.url });
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
