import type { CreateSuggestionRequest, FeedPostInput, TriageInput } from "../../types/suggestions";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  return value;
}

function parseComments(value: unknown): FeedPostInput["comments"] {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError("feedPost.comments must be an array");
  }
  return value.map((item, i) => {
    if (!isPlainObject(item)) {
      throw new ValidationError(`feedPost.comments[${i}] must be an object`);
    }
    return {
      author: optionalString(item.author, `feedPost.comments[${i}].author`),
      text: requiredString(item.text, `feedPost.comments[${i}].text`),
      likes: optionalNumber(item.likes, `feedPost.comments[${i}].likes`),
    };
  });
}

function parseFeedPost(value: unknown): FeedPostInput {
  if (!isPlainObject(value)) {
    throw new ValidationError("feedPost is required");
  }

  const author = value.author;
  let parsedAuthor: FeedPostInput["author"];
  if (author !== undefined && author !== null) {
    if (!isPlainObject(author)) {
      throw new ValidationError("feedPost.author must be an object");
    }
    parsedAuthor = {
      name: optionalString(author.name, "feedPost.author.name"),
      headline: optionalString(author.headline, "feedPost.author.headline"),
      profileUrl: optionalString(author.profileUrl, "feedPost.author.profileUrl"),
      username: optionalString(author.username, "feedPost.author.username"),
    };
  }

  const metrics = value.metrics;
  let parsedMetrics: FeedPostInput["metrics"];
  if (metrics !== undefined && metrics !== null) {
    if (!isPlainObject(metrics)) {
      throw new ValidationError("feedPost.metrics must be an object");
    }
    parsedMetrics = {
      likes: optionalNumber(metrics.likes, "feedPost.metrics.likes"),
      commentsCount: optionalNumber(
        metrics.commentsCount,
        "feedPost.metrics.commentsCount"
      ),
    };
  }

  return {
    id: requiredString(value.id, "feedPost.id"),
    url: optionalString(value.url, "feedPost.url"),
    text: requiredString(value.text, "feedPost.text"),
    author: parsedAuthor,
    metrics: parsedMetrics,
    comments: parseComments(value.comments),
    ageText: optionalString(value.ageText, "feedPost.ageText"),
    extractedAt: requiredString(value.extractedAt, "feedPost.extractedAt"),
  };
}

function parseTriage(value: unknown): TriageInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new ValidationError("triage must be an object");
  }

  let reasons: string[] | undefined;
  if (value.reasons !== undefined && value.reasons !== null) {
    if (!Array.isArray(value.reasons) || !value.reasons.every((r) => typeof r === "string")) {
      throw new ValidationError("triage.reasons must be an array of strings");
    }
    reasons = value.reasons as string[];
  }

  return {
    status: optionalString(value.status, "triage.status"),
    score: optionalNumber(value.score, "triage.score"),
    reasons,
    error: optionalString(value.error, "triage.error"),
    scoredAt: optionalString(value.scoredAt, "triage.scoredAt"),
  };
}

export function parseCreateSuggestionRequest(body: unknown): CreateSuggestionRequest {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const notes = optionalString(body.notes, "notes");
  return {
    feedPost: parseFeedPost(body.feedPost),
    triage: parseTriage(body.triage),
    notes: notes?.trim() ? notes.trim() : undefined,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseJobId(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new ValidationError("jobId must be a UUID");
  }
  return value;
}

const MAX_CLARIFICATION_ANSWER_CHARS = 1000;

/** Validate PATCH /v1/suggestions/:jobId/clarification body. */
export function parseClarificationAnswer(body: unknown): { answer: string } {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const answer = requiredString(body.answer, "answer").trim();
  if (!answer) {
    throw new ValidationError("answer is required");
  }
  if (answer.length > MAX_CLARIFICATION_ANSWER_CHARS) {
    throw new ValidationError(
      `answer must be at most ${MAX_CLARIFICATION_ANSWER_CHARS} characters`
    );
  }
  return { answer };
}
