import { extractJsonBlock } from "../llm/parse";
import type {
  ArtifactConfidence,
  ArtifactShareability,
  DistillDropRecord,
  ExperienceArtifact,
  RawExperienceCandidate,
} from "../types";

const CONFIDENCE: ArtifactConfidence[] = ["high", "medium", "low"];
const SHAREABILITY: ArtifactShareability[] = ["public", "anonymized", "private"];

export type DistillOutcome =
  | { kind: "artifact"; artifact: ExperienceArtifact }
  | { kind: "drop"; drop: DistillDropRecord };

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function drop(
  candidate: RawExperienceCandidate,
  rule: string,
  detail?: string
): DistillDropRecord {
  return {
    id: candidate.id,
    rule,
    title: candidate.title,
    source: candidate.source,
    repo: candidate.repo,
    detail,
  };
}

interface ModelDrop {
  drop?: unknown;
  reason?: unknown;
}

interface ModelArtifact {
  title?: unknown;
  domains?: unknown;
  stack?: unknown;
  problem?: unknown;
  approach?: unknown;
  tradeoff?: unknown;
  claimableLine?: unknown;
  confidence?: unknown;
  shareability?: unknown;
}

export function parseDistillResponse(
  raw: string,
  candidate: RawExperienceCandidate
): DistillOutcome {
  const parsed = JSON.parse(extractJsonBlock(raw)) as ModelDrop & ModelArtifact;

  if (parsed.drop === true) {
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    return {
      kind: "drop",
      drop: drop(candidate, "D_drop", reason || undefined),
    };
  }

  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : candidate.title.trim() || candidate.id;
  const problem = typeof parsed.problem === "string" ? parsed.problem.trim() : "";
  const approach = typeof parsed.approach === "string" ? parsed.approach.trim() : "";
  const tradeoff = typeof parsed.tradeoff === "string" ? parsed.tradeoff.trim() : "";
  const claimableLine =
    typeof parsed.claimableLine === "string" ? parsed.claimableLine.trim() : "";
  const shareability = asEnum(parsed.shareability, SHAREABILITY, "anonymized");
  const confidence = asEnum(parsed.confidence, CONFIDENCE, "medium");
  const domains = asStringArray(parsed.domains, 8);
  const stack = asStringArray(parsed.stack, 8);

  if (!claimableLine) {
    return { kind: "drop", drop: drop(candidate, "D_unclaimable", "empty claimableLine") };
  }
  if (!problem && !approach) {
    return {
      kind: "drop",
      drop: drop(candidate, "D_unclaimable", "empty problem and approach"),
    };
  }
  if (shareability === "private") {
    return { kind: "drop", drop: drop(candidate, "D_private", "shareability=private") };
  }

  return {
    kind: "artifact",
    artifact: {
      id: candidate.id,
      sourceCandidateId: candidate.id,
      source: candidate.source,
      repo: candidate.repo,
      implementationDate: candidate.implementationDate,
      title,
      domains,
      stack,
      problem,
      approach,
      tradeoff,
      claimableLine,
      confidence,
      shareability,
      paths: candidate.paths,
    },
  };
}
