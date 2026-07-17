import type { FeedPost, TriageEntry, TriageResult } from "./types";

/** Message protocol between content script ↔ service worker ↔ side panel */

export const MessageType = {
  POST_VISIBLE: "post_visible",
  TRIAGE_UPDATED: "triage_updated",
  LIST_TRIAGE: "list_triage",
  LIST_TRIAGE_RESULT: "list_triage_result",
  RETRY_TRIAGE: "retry_triage",
  OPEN_SIDE_PANEL: "open_side_panel",
  FOCUS_POST: "focus_post",
  GENERATE_SUGGESTION: "generate_suggestion",
  GENERATE_SUGGESTION_RESULT: "generate_suggestion_result",
  REMOVE_TRIAGE: "remove_triage",
  REMOVE_TRIAGE_RESULT: "remove_triage_result",
  TRIAGE_REMOVED: "triage_removed",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface PostVisibleMessage {
  type: typeof MessageType.POST_VISIBLE;
  post: FeedPost;
}

export interface TriageUpdatedMessage {
  type: typeof MessageType.TRIAGE_UPDATED;
  entry: TriageEntry;
}

export interface ListTriageMessage {
  type: typeof MessageType.LIST_TRIAGE;
}

export interface ListTriageResultMessage {
  type: typeof MessageType.LIST_TRIAGE_RESULT;
  entries: TriageEntry[];
}

export interface RetryTriageMessage {
  type: typeof MessageType.RETRY_TRIAGE;
  feedPostId: string;
}

export interface OpenSidePanelMessage {
  type: typeof MessageType.OPEN_SIDE_PANEL;
}

export interface FocusPostMessage {
  type: typeof MessageType.FOCUS_POST;
  feedPostId: string;
  url?: string;
}

export interface GenerateSuggestionMessage {
  type: typeof MessageType.GENERATE_SUGGESTION;
  feedPostId: string;
  notes?: string;
}

export interface GenerateSuggestionResultMessage {
  type: typeof MessageType.GENERATE_SUGGESTION_RESULT;
  ok: boolean;
  feedPostId: string;
  jobId?: string;
  status?: string;
  error?: string;
}

export interface RemoveTriageMessage {
  type: typeof MessageType.REMOVE_TRIAGE;
  feedPostIds: string[];
}

export interface RemoveTriageResultMessage {
  type: typeof MessageType.REMOVE_TRIAGE_RESULT;
  ok: boolean;
  feedPostIds: string[];
  error?: string;
}

export interface TriageRemovedMessage {
  type: typeof MessageType.TRIAGE_REMOVED;
  feedPostIds: string[];
}

export type ExtensionMessage =
  | PostVisibleMessage
  | TriageUpdatedMessage
  | ListTriageMessage
  | ListTriageResultMessage
  | RetryTriageMessage
  | OpenSidePanelMessage
  | FocusPostMessage
  | GenerateSuggestionMessage
  | GenerateSuggestionResultMessage
  | RemoveTriageMessage
  | RemoveTriageResultMessage
  | TriageRemovedMessage;

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export type { FeedPost, TriageEntry, TriageResult };
