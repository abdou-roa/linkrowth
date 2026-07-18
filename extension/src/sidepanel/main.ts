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
const selectModeEl = document.getElementById("select-mode") as HTMLButtonElement;
const generateSelectedEl = document.getElementById(
  "generate-selected",
) as HTMLButtonElement;
const clearSelectedEl = document.getElementById(
  "clear-selected",
) as HTMLButtonElement;

/** Keep in sync with API / service-worker MAX_BATCH_ITEMS. */
const MAX_BATCH_ITEMS = 50;

let entries: TriageEntry[] = [];
let selectMode = false;
const selectedIds = new Set<string>();
let batchInFlight = false;
let statusMessage = "";

async function loadEntries(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.LIST_TRIAGE,
  });
  if (response?.type === MessageType.LIST_TRIAGE_RESULT) {
    entries = response.entries ?? [];
    pruneSelection();
    render();
  }
}

function pruneSelection(): void {
  const validIds = new Set(entries.map((e) => e.post.id));
  for (const id of selectedIds) {
    if (!validIds.has(id)) selectedIds.delete(id);
  }
}

function visibleEntries(): TriageEntry[] {
  const hideSkips = hideSkipsEl.checked;
  return entries.filter((e) => {
    if (hideSkips && e.triage.status === "not_worth_it") return false;
    if (hideSkips && e.triage.status === "failed") return false;
    return true;
  });
}

function render(): void {
  const visible = visibleEntries();

  listEl.innerHTML = "";
  listEl.classList.toggle("select-mode", selectMode);
  emptyEl.hidden = visible.length > 0;
  renderSummary();
  updateToolbar();

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

  const parts = [`${worth} worth engaging`, `${scanned} scanned`];
  if (analyzing > 0) parts.push(`${analyzing} analyzing`);
  if (selectMode && selectedIds.size > 0) {
    parts.push(`${selectedIds.size} selected`);
  }
  if (statusMessage) parts.push(statusMessage);
  summaryEl.textContent = parts.join(" · ");
}

function updateToolbar(): void {
  selectModeEl.textContent = selectMode ? "Done" : "Select";
  selectModeEl.setAttribute("aria-pressed", String(selectMode));

  const hasSelection = selectMode && selectedIds.size > 0;
  const overLimit = selectedIds.size > MAX_BATCH_ITEMS;

  generateSelectedEl.disabled = !hasSelection || batchInFlight || overLimit;
  generateSelectedEl.textContent = batchInFlight
    ? "Queuing…"
    : selectedIds.size > 0
      ? `Generate (${selectedIds.size})`
      : "Generate";
  generateSelectedEl.title = overLimit
    ? `Select at most ${MAX_BATCH_ITEMS} posts`
    : "";

  clearSelectedEl.disabled = !hasSelection || batchInFlight;
  clearSelectedEl.textContent =
    selectedIds.size > 0 ? `Clear (${selectedIds.size})` : "Clear";
}

function buildRow(entry: TriageEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "list-item";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "row";
  btn.dataset.postId = entry.post.id;
  if (selectMode) {
    btn.classList.add("row-selectable");
    btn.setAttribute("aria-pressed", String(selectedIds.has(entry.post.id)));
  }

  if (selectMode) {
    const checkbox = document.createElement("span");
    checkbox.className = "row-checkbox";
    checkbox.setAttribute("aria-hidden", "true");
    checkbox.dataset.checked = String(selectedIds.has(entry.post.id));
    btn.appendChild(checkbox);
  }

  const content = document.createElement("div");
  content.className = "row-content";

  const status = entry.triage.status as TriageStatus;
  const statusClass = `status-${status}`;
  const author = entry.post.author?.name?.trim() || "Unknown author";
  const score = displayScore(entry.triage.score);
  const tier = scoreTier(entry.triage.score);
  const showScore = status === "worth_it" || status === "not_worth_it";

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
      status === "worth_it" ? TIER_LABEL[tier] : `Score ${score}`;

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
  hint.textContent = selectMode
    ? "Tap to select"
    : entry.post.url
      ? "Click to jump & generate comment"
      : "Post link unavailable";

  content.append(meta, authorEl, snippet);
  if (reasons.textContent) content.appendChild(reasons);
  content.appendChild(hint);
  btn.appendChild(content);

  btn.addEventListener("click", () => {
    if (selectMode) {
      toggleSelected(entry.post.id);
      return;
    }
    void focusPost(entry);
  });

  item.appendChild(btn);
  return item;
}

function toggleSelected(postId: string): void {
  if (selectedIds.has(postId)) selectedIds.delete(postId);
  else selectedIds.add(postId);
  render();
}

function setSelectMode(enabled: boolean): void {
  selectMode = enabled;
  if (!enabled) selectedIds.clear();
  render();
}

async function generateSelected(): Promise<void> {
  if (selectedIds.size === 0 || batchInFlight) return;
  if (selectedIds.size > MAX_BATCH_ITEMS) {
    statusMessage = `Max ${MAX_BATCH_ITEMS} at a time`;
    renderSummary();
    return;
  }

  const feedPostIds = [...selectedIds];
  batchInFlight = true;
  statusMessage = "";
  updateToolbar();

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_SUGGESTIONS_BATCH,
      feedPostIds,
    });

    if (!response?.ok) {
      console.warn(
        "%c🔗 Linkrowth",
        "font-weight:bold",
        "— batch generate failed ❌",
        response?.error,
      );
      statusMessage = response?.error
        ? String(response.error)
        : "Generate failed";
      return;
    }

    const count = Array.isArray(response.results) ? response.results.length : 0;
    statusMessage = `Queued ${count}`;
    selectedIds.clear();
    selectMode = false;
  } catch (error) {
    console.warn(
      "%c🔗 Linkrowth",
      "font-weight:bold",
      "— batch generate failed ❌",
      error,
    );
    statusMessage = error instanceof Error ? error.message : "Generate failed";
  } finally {
    batchInFlight = false;
    render();
  }
}

async function clearSelected(): Promise<void> {
  if (selectedIds.size === 0 || batchInFlight) return;

  const feedPostIds = [...selectedIds];
  clearSelectedEl.disabled = true;
  statusMessage = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.REMOVE_TRIAGE,
      feedPostIds,
    });

    if (!response?.ok) {
      console.warn(
        "%c🔗 Linkrowth",
        "font-weight:bold",
        "— clear failed ❌",
        response?.error,
      );
      statusMessage = response?.error ? String(response.error) : "Clear failed";
      updateToolbar();
      renderSummary();
      return;
    }

    const removed = new Set(response.feedPostIds ?? feedPostIds);
    entries = entries.filter((e) => !removed.has(e.post.id));
    selectedIds.clear();
    selectMode = false;
    render();
  } catch (error) {
    console.warn("%c🔗 Linkrowth", "font-weight:bold", "— clear failed ❌", error);
    statusMessage = error instanceof Error ? error.message : "Clear failed";
    updateToolbar();
    renderSummary();
  }
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

  if (message.type === MessageType.TRIAGE_UPDATED) {
    const idx = entries.findIndex((e) => e.post.id === message.entry.post.id);
    if (idx >= 0) entries[idx] = message.entry;
    else entries.push(message.entry);
    entries.sort((a, b) => {
      const rank = (s: string) => (s === "worth_it" ? 0 : s === "failed" ? 2 : 1);
      const byStatus = rank(a.triage.status) - rank(b.triage.status);
      if (byStatus !== 0) return byStatus;
      return b.triage.score - a.triage.score;
    });
    pruneSelection();
    render();
    return;
  }

  if (message.type === MessageType.TRIAGE_REMOVED) {
    const removed = new Set(message.feedPostIds);
    entries = entries.filter((e) => !removed.has(e.post.id));
    for (const id of removed) selectedIds.delete(id);
    render();
  }
});

hideSkipsEl.addEventListener("change", render);
selectModeEl.addEventListener("click", () => {
  statusMessage = "";
  setSelectMode(!selectMode);
});
generateSelectedEl.addEventListener("click", () => void generateSelected());
clearSelectedEl.addEventListener("click", () => void clearSelected());

void loadEntries();
