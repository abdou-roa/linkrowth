import { MessageType } from "../shared/messages";
import type { FeedPost } from "../shared/types";
import { setBadge } from "./badge";
import { extractFeedPost } from "./extract";
import { observeFullyVisiblePosts } from "./observer";

const seen = new Set<string>();

console.log("%c🔗 Linkrowth", "font-weight:bold;font-size:12px", "— content script running on LinkedIn ✅");

observeFullyVisiblePosts(async (card) => {
  let post: FeedPost | null = null;
  try {
    post = extractFeedPost(card);
  } catch (error) {
    console.warn("%c🔗 Linkrowth", "font-weight:bold", "— extract failed ❌", error);
    setBadge(card, "failed");
    return;
  }

  if (!post) {
    console.warn(
      "%c🔗 Linkrowth",
      "font-weight:bold",
      "— card matched but no id/text could be extracted ⚠️",
      card,
    );
    setBadge(card, "failed");
    return;
  }

  if (seen.has(post.id)) return;
  seen.add(post.id);

  console.log(
    "%c🔗 Linkrowth",
    "font-weight:bold",
    `— queued post 🏷️`,
    post.id.slice(0, 48),
    post.text ? `“${post.text.slice(0, 60)}…”` : "(no text)",
  );

  setBadge(card, "queued");

  try {
    await chrome.runtime.sendMessage({
      type: MessageType.POST_VISIBLE,
      post,
    });
  } catch (error) {
    console.warn("%c🔗 Linkrowth", "font-weight:bold", "— enqueue failed ❌", error);
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

  setBadge(card, entry.triage.status, {
    score: entry.triage.score,
    likes: entry.post.metrics.likes,
  });
});
