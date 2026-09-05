import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Post, UserContext } from "../core/types";
import type { AnalysisArtifact } from "../steps/types";
import type { RetrievalTrace } from "../persistence/retrievalTrace/types";
import { retrieveContext } from "./retrieveContext";
import { generateCandidates } from "./retrievalCandidates";
import { selectForAnalysis } from "./experience/rerank";
import { buildCandidateWindow } from "./experience/select";
import type {
  ExperienceArtifact,
  ExperienceIndex,
  LexicalRankedArtifact,
} from "./experience/types";
import {
  calculateRetrievalEvalMetrics,
  type RetrievalEvalMetrics,
  type RetrievalEvalObservation,
} from "./retrievalEvalMetrics";

interface FixtureArtifact {
  artifact: ExperienceArtifact;
  singleVector: number[];
  situationVector: number[];
  evidenceVector: number[];
}

interface RetrievalEvalRow {
  id: string;
  post: Post;
  analysis: AnalysisArtifact;
  clarification?: {
    status: "answered";
    question: string;
    answer: string;
  };
  artifacts: FixtureArtifact[];
  queryVectors: {
    situation: number[];
    evidence: number[];
  };
  expectedArtifactIds: string[];
  unsafeArtifactIds?: string[];
  lexicalArtifactIds?: string[];
  noMatch?: boolean;
  angleMismatch?: boolean;
}

export interface RetrievalEvalReport {
  fixture: string;
  rows: number;
  legacySingle: RetrievalEvalMetrics;
  phase4: RetrievalEvalMetrics;
  gates: {
    candidateRecallPreserved: boolean;
    finalPrecisionPreserved: boolean;
    angleConditionedPrecisionImproved: boolean;
    safetyExclusionPerfect: boolean;
    noMatchAbstentionPerfect: boolean;
    passed: boolean;
  };
}

const baseContext: UserContext = {
  niche: "engineering",
  positioning: "practitioner",
  targetAudience: "technical leaders",
  proofPoints: [],
};

function readRows(path: string): RetrievalEvalRow[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => JSON.parse(line) as RetrievalEvalRow);
}

function buildIndex(row: RetrievalEvalRow): ExperienceIndex {
  const items: ExperienceIndex["items"] = row.artifacts.map((entry) => ({
    id: entry.artifact.id,
    artifact: entry.artifact,
    vector: entry.singleVector,
    situationVector: entry.situationVector,
    evidenceVector: entry.evidenceVector,
  }));
  return {
    indexedAt: "2026-09-05T00:00:00.000Z",
    schemaVersion: 3,
    embedding: {
      provider: "fixture",
      model: "frozen-phase4",
      dimensions: row.queryVectors.situation.length,
    },
    count: items.length,
    items,
  };
}

async function evaluateRow(row: RetrievalEvalRow): Promise<{
  legacy: RetrievalEvalObservation;
  phase4: RetrievalEvalObservation;
}> {
  const index = buildIndex(row);
  let legacyTrace: RetrievalTrace | undefined;
  await retrieveContext(row.post, baseContext, {
    strategy: "single",
    k: 1,
    minScore: 0.3,
    candidatePoolSize: 10,
    loadIndex: () => index,
    embedQuery: async () => row.queryVectors.situation,
    traceSink: {
      record: (trace) => {
        legacyTrace = trace;
      },
    },
  });
  if (!legacyTrace) throw new Error(`legacy trace missing for ${row.id}`);

  const lexicalRanked: LexicalRankedArtifact[] = (
    row.lexicalArtifactIds ?? []
  )
    .map((id, rank) => {
      const artifact = row.artifacts.find(
        (entry) => entry.artifact.id === id
      )?.artifact;
      return artifact
        ? { artifact, bm25Score: -(rank + 1) }
        : undefined;
    })
    .filter(
      (candidate): candidate is LexicalRankedArtifact =>
        candidate !== undefined
    );
  const shortlist = await generateCandidates(row.post, {
    indexPath: ":fixture:",
    loadIndex: () => index,
    embedQuery: async () => row.queryVectors.situation,
    candidatePoolSize: 10,
    lexicalPoolSize: 10,
    lexicalSearch: (_path, _query, k) =>
      buildCandidateWindow(lexicalRanked, k),
  });
  const selection = await selectForAnalysis(
    row.post,
    row.analysis,
    row.clarification,
    shortlist,
    baseContext,
    {
      indexPath: ":fixture:",
      loadIndex: () => index,
      embedQuery: async () => row.queryVectors.evidence,
      k: 1,
      minSituationScore: 0.3,
      minEvidenceScore: 0.3,
    }
  );

  const common = {
    id: row.id,
    expectedArtifactIds: row.expectedArtifactIds,
    unsafeArtifactIds: row.unsafeArtifactIds ?? [],
    noMatch: row.noMatch ?? false,
    angleMismatch: row.angleMismatch,
  };
  return {
    legacy: {
      ...common,
      candidateArtifactIds: legacyTrace.candidates
        .filter((candidate) => !candidate.prefiltered)
        .map((candidate) => candidate.artifactId),
      selectedArtifactIds: legacyTrace.candidates
        .filter((candidate) => candidate.selected)
        .map((candidate) => candidate.artifactId),
    },
    phase4: {
      ...common,
      candidateArtifactIds: shortlist.candidates.map(
        (candidate) => candidate.artifact.id
      ),
      selectedArtifactIds: selection.selectedArtifactIds,
      evidenceScores: Object.fromEntries(
        selection.trace.candidates
          .filter((candidate) => candidate.evidenceScore !== undefined)
          .map((candidate) => [
            candidate.artifactId,
            candidate.evidenceScore!,
          ])
      ),
    },
  };
}

export async function runRetrievalEvaluation(
  fixturePath: string
): Promise<RetrievalEvalReport> {
  const rows = readRows(fixturePath);
  if (rows.length < 6 || rows.length > 10) {
    throw new Error(
      `Phase 4 comparison requires 6-10 labeled rows; received ${rows.length}`
    );
  }
  const evaluated = await Promise.all(rows.map(evaluateRow));
  const legacySingle = calculateRetrievalEvalMetrics(
    evaluated.map((row) => row.legacy)
  );
  const phase4 = calculateRetrievalEvalMetrics(
    evaluated.map((row) => row.phase4)
  );
  const gates = {
    candidateRecallPreserved:
      phase4.candidateRecallAtN >= legacySingle.candidateRecallAtN,
    finalPrecisionPreserved:
      phase4.finalPrecisionAtK >= legacySingle.finalPrecisionAtK,
    angleConditionedPrecisionImproved:
      phase4.angleConditionedPrecision >
      legacySingle.angleConditionedPrecision,
    safetyExclusionPerfect: phase4.safetyPassRate === 1,
    noMatchAbstentionPerfect: phase4.abstentionAccuracy === 1,
    passed: false,
  };
  gates.passed = Object.entries(gates)
    .filter(([name]) => name !== "passed")
    .every(([, value]) => value);

  return {
    fixture: fixturePath,
    rows: rows.length,
    legacySingle,
    phase4,
    gates,
  };
}

function fixtureArg(args: string[]): string {
  const fixtureIndex = args.indexOf("--fixture");
  const supplied =
    fixtureIndex >= 0 && args[fixtureIndex + 1]?.startsWith("-") === false
      ? args[fixtureIndex + 1]
      : undefined;
  return supplied
    ? resolve(supplied)
    : resolve(
        __dirname,
        "__fixtures__",
        "phase4-eval.sample.jsonl"
      );
}

async function main(): Promise<void> {
  const report = await runRetrievalEvaluation(fixtureArg(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  if (!report.gates.passed) process.exitCode = 1;
}

if (require.main === module) {
  void main();
}
