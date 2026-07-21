import { MessageType } from "../shared/messages";
import type { FeedPost } from "../shared/types";
import { flashCard, removeBadge, setBadge } from "./badge";
import { observeNativeCommentOpens, prepareGenerateComposer } from "./composer";
import { extractFeedPost } from "./extract";
import { observeFullyVisiblePosts } from "./observer";

const seen = new Set<string>();

console.log("%c🔗 Linkrowth", "font-weight:bold;font-size:12px", "— content script running on LinkedIn ✅");

observeNativeCommentOpens();

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MessageType.TRIAGE_UPDATED) {
    const entry = message.entry;
    if (!entry?.post?.id) return;

    const card = document.querySelector<HTMLElement>(
      `[data-linkrowth-post-id="${CSS.escape(entry.post.id)}"]`,
    );
    if (!card) return;

    setBadge(card, entry.triage.status, {
      score: entry.triage.score,
    });
    return;
  }

  if (message?.type === MessageType.FOCUS_POST) {
    void focusPostInFeed(message.feedPostId).then((ok) => {
      sendResponse({ ok });
    });
    return true;
  }

  if (message?.type === MessageType.TRIAGE_REMOVED) {
    for (const feedPostId of message.feedPostIds) {
      seen.delete(feedPostId);
      const card = document.querySelector<HTMLElement>(
        `[data-linkrowth-post-id="${CSS.escape(feedPostId)}"]`,
      );
      if (card) removeBadge(card);
    }
  }
});

async function focusPostInFeed(feedPostId: string): Promise<boolean> {
  const card = document.querySelector<HTMLElement>(
    `[data-linkrowth-post-id="${CSS.escape(feedPostId)}"]`,
  );
  if (!card) return false;

  card.scrollIntoView({ behavior: "smooth", block: "center" });
  flashCard(card);

  // Give the scroll a moment, then open the comment composer + Generate CTA.
  await wait(450);
  try {
    await prepareGenerateComposer(card, feedPostId);
  } catch (error) {
    console.warn(
      "%c🔗 Linkrowth",
      "font-weight:bold",
      "— prepare generate composer failed ⚠️",
      error,
    );
  }

  return true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
