import type { FeedPost } from "../shared/types";

/**
 * Extract a FeedPost from a LinkedIn feed card.
 * DOM is brittle — keep this isolated; improve with fixtures later.
 */
export function extractFeedPost(card: HTMLElement): FeedPost | null {
  const text = extractText(card);
  if (!text) return null;

  const url = extractUrl(card);
  const id = extractId(card, url, text);
  card.dataset.linkrowthPostId = id;

  return {
    id,
    url,
    text,
    author: {
      name: textOf(card.querySelector(".update-components-actor__title span[aria-hidden='true'], .update-components-actor__title")),
      headline: textOf(card.querySelector(".update-components-actor__description")),
    },
    metrics: {
      likes: parseCount(
        textOf(
          card.querySelector(
            ".social-details-social-counts__reactions-count, .social-details-social-counts__count-value",
          ),
        ),
      ),
      commentsCount: parseCount(
        textOf(card.querySelector('button[aria-label*="comment" i], .social-details-social-counts__comments')),
      ),
    },
    extractedAt: new Date().toISOString(),
  };
}

function extractText(card: HTMLElement): string {
  const node = card.querySelector(
    ".feed-shared-update-v2__description, .update-components-text, .feed-shared-text",
  );
  return textOf(node);
}

function extractUrl(card: HTMLElement): string | undefined {
  const anchor = card.querySelector<HTMLAnchorElement>(
    'a[href*="/feed/update/"], a[href*="/posts/"]',
  );
  return anchor?.href;
}

function extractId(card: HTMLElement, url: string | undefined, text: string): string {
  const urn = card.getAttribute("data-urn") || card.getAttribute("data-id");
  if (urn) return urn;
  if (url) return `url:${url}`;
  return `hash:${simpleHash(text)}`;
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
