import type { FeedPost } from "../shared/types";

/**
 * Extract a FeedPost from a LinkedIn feed card.
 * Tries modern data-view-name / data-testid hooks first, then legacy class names.
 */
export function extractFeedPost(card: HTMLElement): FeedPost | null {
  const text = extractText(card);
  const url = extractUrl(card);
  const id = extractId(card, url, text);

  if (!id) return null;

  // Media-only posts still get a card entry (empty text).
  card.dataset.linkrowthPostId = id;

  return {
    id,
    url,
    text: text || "",
    author: {
      name: extractAuthorName(card),
      headline: extractHeadline(card),
    },
    metrics: {
      likes: parseCount(extractReactions(card)),
      commentsCount: parseCount(extractComments(card)),
    },
    extractedAt: new Date().toISOString(),
  };
}

function extractText(card: HTMLElement): string {
  const node = card.querySelector(
    [
      '[data-testid="expandable-text-box"]',
      '[data-view-name="feed-commentary"]',
      ".update-components-update-v2__commentary",
      ".feed-shared-update-v2__description",
      ".feed-shared-inline-show-more-text",
      ".update-components-text",
      ".feed-shared-text",
      ".break-words",
    ].join(", "),
  );
  if (!node) return "";
  const clone = node.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      '[data-testid="expandable-text-button"], .feed-shared-inline-show-more-text__see-more-less-toggle',
    )
    .forEach((el) => el.remove());
  return textOf(clone);
}

function extractAuthorName(card: HTMLElement): string | undefined {
  const modern = textOf(
    card.querySelector(
      '[data-view-name="feed-actor-image"] + a p, [data-view-name="feed-header-text"], .update-components-actor__title span[aria-hidden="true"], .update-components-actor__title span[dir="ltr"] > span[aria-hidden="true"], .update-components-actor__title',
    ),
  );
  if (modern) return modern;

  const menu = card.querySelector<HTMLElement>(
    'button[aria-label*="control menu" i], button[aria-label*="Open control menu" i]',
  );
  const label = menu?.getAttribute("aria-label") ?? "";
  const match = label.match(/for .+ by (.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function extractHeadline(card: HTMLElement): string | undefined {
  const h = textOf(
    card.querySelector(
      '.update-components-actor__description span[aria-hidden="true"], .update-components-actor__description',
    ),
  );
  return h || undefined;
}

function extractReactions(card: HTMLElement): string | undefined {
  return (
    textOf(
      card.querySelector(
        '[data-view-name="feed-reaction-count"], .social-details-social-counts__reactions-count, .social-details-social-counts__count-value',
      ),
    ) || undefined
  );
}

function extractComments(card: HTMLElement): string | undefined {
  return (
    textOf(
      card.querySelector(
        '[data-view-name="feed-comment-count"], .social-details-social-counts__comments, button[aria-label*="comment" i]',
      ),
    ) || undefined
  );
}

function extractUrl(card: HTMLElement): string | undefined {
  const anchor = card.querySelector<HTMLAnchorElement>(
    'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="urn:li:activity"]',
  );
  return anchor?.href;
}

function extractId(
  card: HTMLElement,
  url: string | undefined,
  text: string,
): string | null {
  const componentKey =
    card.getAttribute("componentkey") ||
    card.closest("[componentkey]")?.getAttribute("componentkey");
  if (componentKey) return `ck:${componentKey}`;

  const urn =
    card.getAttribute("data-urn") ||
    card.getAttribute("data-id") ||
    card.closest("[data-urn]")?.getAttribute("data-urn") ||
    card.closest("[data-id]")?.getAttribute("data-id");
  if (urn) return urn;

  if (url) return `url:${url}`;
  if (text) return `hash:${simpleHash(text)}`;
  return null;
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseCount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.KkMm]/g, "");
  const match = cleaned.match(/([\d.]+)\s*([KkMm])?/);
  if (!match) return undefined;
  let n = Number(match[1]);
  if (Number.isNaN(n)) return undefined;
  const suffix = match[2]?.toLowerCase();
  if (suffix === "k") n *= 1_000;
  if (suffix === "m") n *= 1_000_000;
  return Math.round(n);
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
