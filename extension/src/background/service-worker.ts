import { JobQueue } from "../shared/queue";
import { MessageType, isExtensionMessage } from "../shared/messages";
import type { ExtensionMessage, TriageEntry } from "../shared/messages";
import { scoreFeedPost } from "../shared/scoring";
import { triageStore } from "../shared/store";
import type { FeedPost } from "../shared/types";

const queue = new JobQueue(2);
const inFlight = new Set<string>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;

  void handleMessage(message)
    .then((result) => sendResponse(result ?? { ok: true }))
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: msg });
    });

  return true; // async response
});

async function handleMessage(
  message: ExtensionMessage,
): Promise<Record<string, unknown> | void> {
  switch (message.type) {
    case MessageType.POST_VISIBLE:
      enqueueTriage(message.post);
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
      enqueueTriage(existing.post, true);
      return;
    }

    case MessageType.OPEN_SIDE_PANEL:
      // Panel open is typically triggered via action click / setPanelBehavior.
      return;

    default:
      return;
  }
}

function enqueueTriage(post: FeedPost, force = false): void {
  queue.enqueue(async () => {
    if (!force && (await triageStore.has(post.id))) return;
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
    broadcast({ type: MessageType.TRIAGE_UPDATED, entry: roasting });

    try {
      const triage = scoreFeedPost(post);
      const done: TriageEntry = { post, triage };
      await triageStore.upsert(done);
      broadcast({ type: MessageType.TRIAGE_UPDATED, entry: done });
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
      broadcast({ type: MessageType.TRIAGE_UPDATED, entry: failed });
    } finally {
      inFlight.delete(post.id);
    }
  });
}

function broadcast(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No side-panel listener yet — fine.
  });
}
