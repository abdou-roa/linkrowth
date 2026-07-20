import { MessageType } from "../shared/messages";
import type { GenerateSuggestionResultMessage } from "../shared/messages";

const NOTES_PLACEHOLDER =
  "Write notes or leave empty for a Quick suggestion";

const GENERATE_BTN_CLASS = "linkrowth-generate-btn";
const STATUS_CLASS = "linkrowth-generate-status";

/** Open LinkedIn's comment composer and wire Generate comment CTA. */
export async function prepareGenerateComposer(
  card: HTMLElement,
  feedPostId: string,
): Promise<boolean> {
  const opened = await openCommentBox(card);
  if (!opened) {
    console.warn(
      "%c🔗 Linkrowth",
      "font-weight:bold",
      "— could not open comment box ⚠️",
      card,
    );
    return false;
  }

  const editor = await waitForEditor(card, 2500);
  if (!editor) {
    console.warn(
      "%c🔗 Linkrowth",
      "font-weight:bold",
      "— comment editor not found ⚠️",
      card,
    );
    return false;
  }

  applyPlaceholder(editor);
  injectGenerateUi(card, editor, feedPostId);
  editor.focus();
  return true;
}

async function openCommentBox(card: HTMLElement): Promise<boolean> {
  if (findEditor(card)) return true;

  const commentBtn = findCommentButton(card);
  if (!commentBtn) return false;

  commentBtn.click();
  const editor = await waitForEditor(card, 2500);
  return !!editor;
}

function findCommentButton(card: HTMLElement): HTMLElement | null {
  const selectors = [
    'button[aria-label*="Comment" i]',
    'button[aria-label*="comment" i]',
    'button.comment-button',
    'button[data-control-name="comment"]',
  ];

  for (const sel of selectors) {
    const btn = card.querySelector<HTMLElement>(sel);
    if (btn) return btn;
  }

  // Fallback: social action buttons by visible label
  for (const btn of card.querySelectorAll<HTMLElement>("button")) {
    const label = (
      btn.getAttribute("aria-label") ||
      btn.textContent ||
      ""
    ).trim();
    if (/^comment\b/i.test(label) || /^comments?\b/i.test(label)) {
      return btn;
    }
  }

  return null;
}

function findEditor(card: HTMLElement): HTMLElement | null {
  const selectors = [
    ".comments-comment-box div.ql-editor[contenteditable='true']",
    ".comments-comment-box div[contenteditable='true']",
    ".comments-comment-texteditor div[contenteditable='true']",
    "form.comments-comment-box__form div[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    'div[role="textbox"][contenteditable="true"]',
    "textarea.comments-comment-box__editor",
    "textarea",
  ];

  for (const sel of selectors) {
    const el = card.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

function waitForEditor(
  card: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const existing = findEditor(card);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const started = Date.now();
    const obs = new MutationObserver(() => {
      const editor = findEditor(card);
      if (editor) {
        obs.disconnect();
        resolve(editor);
      } else if (Date.now() - started > timeoutMs) {
        obs.disconnect();
        resolve(null);
      }
    });
    obs.observe(card, { childList: true, subtree: true });
    window.setTimeout(() => {
      obs.disconnect();
      resolve(findEditor(card));
    }, timeoutMs);
  });
}

function applyPlaceholder(editor: HTMLElement): void {
  if (editor instanceof HTMLTextAreaElement) {
    editor.placeholder = NOTES_PLACEHOLDER;
    return;
  }

  editor.setAttribute("data-placeholder", NOTES_PLACEHOLDER);
  editor.setAttribute("aria-placeholder", NOTES_PLACEHOLDER);
  editor.setAttribute("data-linkrowth-placeholder", NOTES_PLACEHOLDER);

  // Quill / LinkedIn often reads placeholder from a sibling or data attr on parent.
  const box =
    editor.closest<HTMLElement>(".comments-comment-box") ??
    editor.closest<HTMLElement>("form") ??
    editor.parentElement;
  if (box) {
    box.setAttribute("data-placeholder", NOTES_PLACEHOLDER);
  }

  // If the editor is empty, mirror placeholder via a CSS attr hook.
  syncEmptyClass(editor);
  editor.addEventListener("input", () => syncEmptyClass(editor));
}

function syncEmptyClass(editor: HTMLElement): void {
  const empty = readEditorText(editor).trim() === "";
  editor.classList.toggle("linkrowth-editor-empty", empty);
  editor.dataset.linkrowthEmpty = empty ? "true" : "false";
}

function injectGenerateUi(
  card: HTMLElement,
  editor: HTMLElement,
  feedPostId: string,
): void {
  // Avoid duplicate wiring for the same card session.
  const existing = card.querySelector<HTMLButtonElement>(
    `:scope .${GENERATE_BTN_CLASS}`,
  );
  if (existing) {
    existing.dataset.feedPostId = feedPostId;
    setButtonState(existing, "idle");
    return;
  }

  const actions =
    findActionsRow(card, editor) ?? createActionsRow(editor);

  // Soft-hide LinkedIn's native comment submit while our CTA is present.
  const formRoot =
    editor.closest<HTMLElement>("form") ??
    editor.closest<HTMLElement>(".comments-comment-box") ??
    actions;
  hideNativeSubmit(formRoot);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = GENERATE_BTN_CLASS;
  btn.dataset.feedPostId = feedPostId;
  btn.textContent = "Generate comment";

  const status = document.createElement("span");
  status.className = STATUS_CLASS;
  status.hidden = true;

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onGenerateClick(btn, status, editor);
  });

  actions.append(btn, status);
}

function findActionsRow(
  card: HTMLElement,
  editor: HTMLElement,
): HTMLElement | null {
  const form =
    editor.closest<HTMLElement>("form") ??
    card.querySelector<HTMLElement>(".comments-comment-box__form") ??
    card.querySelector<HTMLElement>(".comments-comment-box");

  if (!form) return null;

  const candidates = [
    ".comments-comment-box__submit-button",
    ".comments-comment-box__controls",
    ".display-flex.justify-flex-end",
    '[class*="comment-box"] button[type="submit"]',
  ];

  for (const sel of candidates) {
    const el = form.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const row = el.closest<HTMLElement>("div") ?? el.parentElement;
    if (row) return row;
  }

  // Prefer a footer-ish container inside the form.
  const buttons = form.querySelectorAll("button");
  const lastBtn = buttons[buttons.length - 1];
  return lastBtn?.parentElement ?? null;
}

function createActionsRow(editor: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "linkrowth-generate-actions";
  const parent =
    editor.closest<HTMLElement>(".comments-comment-box") ??
    editor.parentElement ??
    editor;
  parent.appendChild(row);
  return row;
}

function hideNativeSubmit(actions: HTMLElement): void {
  for (const btn of actions.querySelectorAll<HTMLElement>("button")) {
    if (btn.classList.contains(GENERATE_BTN_CLASS)) continue;
    const label = (btn.getAttribute("aria-label") || btn.textContent || "")
      .trim()
      .toLowerCase();
    if (
      label === "post" ||
      label === "comment" ||
      label.includes("post comment") ||
      btn.getAttribute("type") === "submit"
    ) {
      btn.classList.add("linkrowth-native-submit-hidden");
    }
  }
}

async function onGenerateClick(
  btn: HTMLButtonElement,
  status: HTMLElement,
  editor: HTMLElement,
): Promise<void> {
  const feedPostId = btn.dataset.feedPostId;
  if (!feedPostId) return;

  const notes = readEditorText(editor).trim();
  setButtonState(btn, "loading");
  showStatus(status, "Generating…");

  try {
    const response = (await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_SUGGESTION,
      feedPostId,
      notes: notes || undefined,
    })) as GenerateSuggestionResultMessage & { ok?: boolean; error?: string };

    if (!response?.ok || !response.suggestion) {
      setButtonState(btn, "error");
      showStatus(status, response?.error || "Failed to generate suggestion");
      return;
    }

    writeEditorText(editor, response.suggestion);
    setButtonState(btn, "idle");
    showStatus(
      status,
      response.category
        ? `Ready · ${response.category}`
        : "Ready — review before posting",
    );
  } catch (error) {
    setButtonState(btn, "error");
    showStatus(
      status,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function writeEditorText(editor: HTMLElement, text: string): void {
  editor.focus();

  if (
    editor instanceof HTMLTextAreaElement ||
    editor instanceof HTMLInputElement
  ) {
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    syncEmptyClass(editor);
    return;
  }

  // Quill / contenteditable: select all then insertText so LinkedIn sees the change.
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    editor.textContent = text;
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText",
      }),
    );
  }

  syncEmptyClass(editor);
}

function setButtonState(
  btn: HTMLButtonElement,
  state: "idle" | "loading" | "error",
): void {
  btn.dataset.state = state;
  btn.disabled = state === "loading";

  switch (state) {
    case "loading":
      btn.textContent = "Generating…";
      break;
    case "error":
      btn.textContent = "Retry generate";
      break;
    default:
      btn.textContent = "Generate comment";
  }
}

function showStatus(el: HTMLElement, text: string): void {
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function readEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement) return editor.value;
  if (editor instanceof HTMLInputElement) return editor.value;
  return (editor.innerText || editor.textContent || "").replace(
    /\u200b/g,
    "",
  );
}

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
