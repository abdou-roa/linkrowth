/** Linkrowth API client — used from the service worker. */

export interface CreateSuggestionBody {
  feedPost: {
    id: string;
    url?: string;
    text: string;
    author?: {
      name?: string;
      headline?: string;
      profileUrl?: string;
      username?: string;
    };
    metrics?: {
      likes?: number;
      commentsCount?: number;
    };
    comments?: Array<{
      author?: string;
      text: string;
      likes?: number;
    }>;
    ageText?: string;
    extractedAt: string;
  };
  triage?: {
    status?: string;
    score?: number;
    reasons?: string[];
    error?: string;
    scoredAt?: string;
  };
  notes?: string;
}

export interface CreateSuggestionResponse {
  jobId: string;
  postId: string;
  status: string;
}

export interface CreateSuggestionsBatchBody {
  items: CreateSuggestionBody[];
}

export interface CreateSuggestionsBatchResponse {
  results: CreateSuggestionResponse[];
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}

function apiBaseUrl(): string {
  const url = import.meta.env.LINKROWTH_API_URL?.trim();
  if (!url) {
    throw new Error(
      "LINKROWTH_API_URL is not set. Copy extension/.env.example to .env and rebuild.",
    );
  }
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  const key = import.meta.env.LINKROWTH_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "LINKROWTH_API_KEY is not set. Copy extension/.env.example to .env and rebuild.",
    );
  }
  return key;
}

export async function createSuggestion(
  body: CreateSuggestionBody,
): Promise<CreateSuggestionResponse> {
  const res = await fetch(`${apiBaseUrl()}/v1/suggestions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as
    | CreateSuggestionResponse
    | ApiErrorBody;

  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(
      err.message || err.error || `API error ${res.status}`,
    );
  }

  const ok = data as CreateSuggestionResponse;
  if (!ok.jobId) {
    throw new Error("API response missing jobId");
  }
  return ok;
}

export async function createSuggestionsBatch(
  body: CreateSuggestionsBatchBody,
): Promise<CreateSuggestionsBatchResponse> {
  const res = await fetch(`${apiBaseUrl()}/v1/suggestions/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as
    | CreateSuggestionsBatchResponse
    | ApiErrorBody;

  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(
      err.message || err.error || `API error ${res.status}`,
    );
  }

  const ok = data as CreateSuggestionsBatchResponse;
  if (!Array.isArray(ok.results)) {
    throw new Error("API response missing results");
  }
  return ok;
}
