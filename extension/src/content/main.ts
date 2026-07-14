import { MessageType } from "../shared/messages";
import type { FeedPost } from "../shared/types";
import { setBadge } from "./badge";
import { extractFeedPost } from "./extract";
import { observeFullyVisiblePosts } from "./observer";

const seen = new Set<string>();

console.info("[linkrowth] content script loaded");

observeFullyVisiblePosts(async (card) => {
  let post: FeedPost | null = null;
  try {
    post = extractFeedPost(card);
  } catch (error) {
    console.warn("[linkrowth] extract failed", error);
    return;
  }

  if (!post || seen.has(post.id)) return;
  seen.add(post.id);

  setBadge(card, "queued");

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.POST_VISIBLE,
      post,
    });
  } catch (error) {
    console.warn("[linkrowth] failed to enqueue post", error);
    setBadge(card, "failed");
    seen.delete(post.id);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== MessageType.TRIAGE_UPDATED) return;
  const entry = message.entry;
  if (!entry?.post?.id) return;

  const card = document.querySelector<HTMLElement>(
    `[data-linkrowth-post-id="${CSS.escape(entry.post.id)}"]`,
  );
  if (!card) return;

  setBadge(card, entry.triage.status);
});
