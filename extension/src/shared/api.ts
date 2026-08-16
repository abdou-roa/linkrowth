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

export interface SuggestionRunSummary {
  suggestion: string | null;
  rationale: string | null;
  category: string | null;
  agentId: string | null;
}

export interface GetSuggestionResponse {
  jobId: string;
  postId: string;
  status: "queued" | "running" | "awaiting_clarification" | "succeeded" | "failed" | string;
  error: string | null;
  run: SuggestionRunSummary | null;
  clarification?: {
    status?: string;
    question?: string | null;
    reason?: string | null;
    answer?: string | null;
  } | null;
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

export async function getSuggestion(
  jobId: string,
): Promise<GetSuggestionResponse> {
  const res = await fetch(
    `${apiBaseUrl()}/v1/suggestions/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
      },
    },
  );

  const data = (await res.json().catch(() => ({}))) as
    | GetSuggestionResponse
    | ApiErrorBody;

  if (!res.ok) {
    const err = data as ApiErrorBody;
    throw new Error(
      err.message || err.error || `API error ${res.status}`,
    );
  }

  const ok = data as GetSuggestionResponse;
  if (!ok.jobId) {
    throw new Error("API response missing jobId");
  }
  return ok;
}

const SETTLED_STATUSES = new Set([
  "succeeded",
  "failed",
  "awaiting_clarification",
]);

/**
 * Poll GET /v1/suggestions/:jobId until the job finishes, pauses for
 * clarification, or times out.
 */
export async function waitForSuggestion(
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<GetSuggestionResponse> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const started = Date.now();

  for (;;) {
    const job = await getSuggestion(jobId);
    if (SETTLED_STATUSES.has(job.status)) {
      return job;
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(
        `Suggestion job timed out after ${Math.round(timeoutMs / 1000)}s (status: ${job.status})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
