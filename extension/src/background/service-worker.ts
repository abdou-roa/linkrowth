import { JobQueue } from "../shared/queue";
import { createSuggestion, waitForSuggestion } from "../shared/api";
import { MessageType, isExtensionMessage } from "../shared/messages";
import type { ExtensionMessage, TriageEntry } from "../shared/messages";
import { scoreFeedPost } from "../shared/scoring";
import { triageStore } from "../shared/store";
import type { FeedPost } from "../shared/types";

const queue = new JobQueue(2);
const inFlight = new Set<string>();

console.log("%c🔗 Linkrowth", "font-weight:bold;font-size:12px", "— service worker awake ✅");

chrome.runtime.onInstalled.addListener(() => {
  console.log("%c🔗 Linkrowth", "font-weight:bold", "— extension installed / updated 🧩");
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;

  void handleMessage(message, sender)
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: msg });
    });

  return true; // async response
});

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<Record<string, unknown> | void> {
  switch (message.type) {
    case MessageType.POST_VISIBLE:
      enqueueTriage(message.post, false, sender.tab?.id);
      return;

    case MessageType.LIST_TRIAGE: {
      const entries = await triageStore.list();
      return { type: MessageType.LIST_TRIAGE_RESULT, entries };
    }

    case MessageType.RETRY_TRIAGE: {
      const existing = await triageStore.get(message.feedPostId);
      if (!existing) {
        return { ok: false, error: "unknown post" };
      }
      inFlight.delete(message.feedPostId);
      enqueueTriage(existing.post, true, sender.tab?.id);
      return;
    }

    case MessageType.OPEN_SIDE_PANEL:
      // Panel open is typically triggered via action click / setPanelBehavior.
      return;

    case MessageType.GENERATE_SUGGESTION:
      return enqueueSuggestion(message.feedPostId, message.notes);

    case MessageType.REMOVE_TRIAGE:
      return removeTriageEntries(message.feedPostIds);

    default:
      return;
  }
}

async function removeTriageEntries(
  feedPostIds: string[],
): Promise<Record<string, unknown>> {
  const ids = [...new Set(feedPostIds.filter(Boolean))];
  if (ids.length === 0) {
    return {
      type: MessageType.REMOVE_TRIAGE_RESULT,
      ok: true,
      feedPostIds: [],
    };
  }

  try {
    await triageStore.removeMany(ids);
    for (const feedPostId of ids) {
      inFlight.delete(feedPostId);
    }
    broadcast({ type: MessageType.TRIAGE_REMOVED, feedPostIds: ids });
    return {
      type: MessageType.REMOVE_TRIAGE_RESULT,
      ok: true,
      feedPostIds: ids,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      type: MessageType.REMOVE_TRIAGE_RESULT,
      ok: false,
      feedPostIds: ids,
      error: msg,
    };
  }
}

async function enqueueSuggestion(
  feedPostId: string,
  notes?: string,
): Promise<Record<string, unknown>> {
  const entry = await triageStore.get(feedPostId);
  if (!entry) {
    return {
      type: MessageType.GENERATE_SUGGESTION_RESULT,
      ok: false,
      feedPostId,
      error: "Post not found in triage store — scroll it into view first",
    };
  }

  try {
    const { triage, post } = entry;
    const created = await createSuggestion({
      feedPost: {
        id: post.id,
        url: post.url,
        text: post.text,
        author: post.author,
        metrics: post.metrics,
        comments: post.comments,
        ageText: post.ageText,
        extractedAt: post.extractedAt,
      },
      triage: {
        status: triage.status,
        score: triage.score,
        reasons: triage.reasons,
        error: triage.error,
        scoredAt: triage.scoredAt,
      },
      notes: notes?.trim() ? notes.trim() : undefined,
    });

    const job = await waitForSuggestion(created.jobId);

    if (job.status === "failed") {
      return {
        type: MessageType.GENERATE_SUGGESTION_RESULT,
        ok: false,
        feedPostId,
        jobId: job.jobId,
        status: job.status,
        error: job.error || "Suggestion job failed",
      };
    }

    const suggestion = job.run?.suggestion?.trim();
    if (!suggestion) {
      return {
        type: MessageType.GENERATE_SUGGESTION_RESULT,
        ok: false,
        feedPostId,
        jobId: job.jobId,
        status: job.status,
        error: "Job succeeded but no suggestion was returned",
      };
    }

    return {
      type: MessageType.GENERATE_SUGGESTION_RESULT,
      ok: true,
      feedPostId,
      jobId: job.jobId,
      status: job.status,
      suggestion,
      rationale: job.run?.rationale ?? undefined,
      category: job.run?.category ?? undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn("%c🔗 Linkrowth", "font-weight:bold", "— suggestion failed ❌", msg);
    return {
      type: MessageType.GENERATE_SUGGESTION_RESULT,
      ok: false,
      feedPostId,
      error: msg,
    };
  }
}

function enqueueTriage(
  post: FeedPost,
  force = false,
  tabId?: number,
): void {
  queue.enqueue(async () => {
    if (!force) {
      const existing = await triageStore.get(post.id);
      if (existing) {
        // Re-announce so the feed badge can attach after LinkedIn recycles DOM,
        // or when the content script missed the original broadcast.
        broadcast({ type: MessageType.TRIAGE_UPDATED, entry: existing }, tabId);
        return;
      }
    }
    if (inFlight.has(post.id)) return;
    inFlight.add(post.id);

    const roasting: TriageEntry = {
      post,
      triage: {
        feedPostId: post.id,
        status: "roasting",
        score: 0,
        reasons: [],
      },
    };
    await triageStore.upsert(roasting);
    broadcast({ type: MessageType.TRIAGE_UPDATED, entry: roasting }, tabId);

    try {
      const triage = scoreFeedPost(post);
      const done: TriageEntry = { post, triage };
      await triageStore.upsert(done);
      broadcast({ type: MessageType.TRIAGE_UPDATED, entry: done }, tabId);
    } catch (error) {
      const failed: TriageEntry = {
        post,
        triage: {
          feedPostId: post.id,
          status: "failed",
          score: 0,
          reasons: [],
          error: error instanceof Error ? error.message : String(error),
          scoredAt: new Date().toISOString(),
        },
      };
      await triageStore.upsert(failed);
      broadcast({ type: MessageType.TRIAGE_UPDATED, entry: failed }, tabId);
    } finally {
      inFlight.delete(post.id);
    }
  });
}

/**
 * Notify extension pages (side panel) and LinkedIn content scripts.
 * `chrome.runtime.sendMessage` does not reach content scripts — those need
 * `chrome.tabs.sendMessage`.
 */
function broadcast(message: ExtensionMessage, tabId?: number): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No side-panel listener yet — fine.
  });

  if (typeof tabId === "number") {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Tab closed or content script not injected yet.
    });
    return;
  }

  void chrome.tabs
    .query({ url: ["https://www.linkedin.com/*"] })
    .then((tabs) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab without our content script — ignore.
        });
      }
    })
    .catch(() => {
      // tabs.query can fail without host access in rare cases.
    });
}
