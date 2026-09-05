export interface RetrievalEvalObservation {
  id: string;
  expectedArtifactIds: string[];
  candidateArtifactIds: string[];
  selectedArtifactIds: string[];
  unsafeArtifactIds: string[];
  noMatch: boolean;
  angleMismatch?: boolean;
  evidenceScores?: Record<string, number>;
}

export interface RetrievalEvalMetrics {
  rows: number;
  candidateRecallAtN: number;
  mrr: number;
  ndcg: number;
  finalPrecisionAtK: number;
  angleConditionedPrecision: number;
  evidenceSeparation: number;
  safetyPassRate: number;
  abstentionAccuracy: number;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function precision(row: RetrievalEvalObservation): number {
  if (row.noMatch) return row.selectedArtifactIds.length === 0 ? 1 : 0;
  if (row.selectedArtifactIds.length === 0) return 0;
  const expected = new Set(row.expectedArtifactIds);
  return (
    row.selectedArtifactIds.filter((id) => expected.has(id)).length /
    row.selectedArtifactIds.length
  );
}

function reciprocalRank(row: RetrievalEvalObservation): number {
  const expected = new Set(row.expectedArtifactIds);
  const rank = row.candidateArtifactIds.findIndex((id) => expected.has(id));
  return rank < 0 ? 0 : 1 / (rank + 1);
}

function ndcg(row: RetrievalEvalObservation): number {
  const expected = new Set(row.expectedArtifactIds);
  if (!expected.size) return row.candidateArtifactIds.length === 0 ? 1 : 0;
  const dcg = row.candidateArtifactIds.reduce(
    (sum, id, index) =>
      sum + (expected.has(id) ? 1 / Math.log2(index + 2) : 0),
    0
  );
  const idealCount = Math.min(expected.size, row.candidateArtifactIds.length);
  const ideal = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2)
  ).reduce((sum, value) => sum + value, 0);
  return ideal ? dcg / ideal : 0;
}

function evidenceSeparation(row: RetrievalEvalObservation): number | undefined {
  if (!row.evidenceScores || row.expectedArtifactIds.length === 0) {
    return undefined;
  }
  const expected = new Set(row.expectedArtifactIds);
  const positive = Object.entries(row.evidenceScores)
    .filter(([id]) => expected.has(id))
    .map(([, score]) => score);
  const negative = Object.entries(row.evidenceScores)
    .filter(([id]) => !expected.has(id))
    .map(([, score]) => score);
  if (!positive.length || !negative.length) return undefined;
  return Math.max(...positive) - Math.max(...negative);
}

export function calculateRetrievalEvalMetrics(
  rows: RetrievalEvalObservation[]
): RetrievalEvalMetrics {
  const matchRows = rows.filter((row) => !row.noMatch);
  const angleRows = matchRows.filter((row) => row.angleMismatch);
  const noMatchRows = rows.filter((row) => row.noMatch);
  const separations = rows
    .map(evidenceSeparation)
    .filter((value): value is number => value !== undefined);

  return {
    rows: rows.length,
    candidateRecallAtN: mean(
      matchRows.map((row) => {
        const expected = new Set(row.expectedArtifactIds);
        return row.candidateArtifactIds.some((id) => expected.has(id)) ? 1 : 0;
      })
    ),
    mrr: mean(matchRows.map(reciprocalRank)),
    ndcg: mean(matchRows.map(ndcg)),
    finalPrecisionAtK: mean(rows.map(precision)),
    angleConditionedPrecision: mean(angleRows.map(precision)),
    evidenceSeparation: mean(separations),
    safetyPassRate: mean(
      rows.map((row) => {
        const unsafe = new Set(row.unsafeArtifactIds);
        return row.selectedArtifactIds.some((id) => unsafe.has(id)) ? 0 : 1;
      })
    ),
    abstentionAccuracy: mean(
      noMatchRows.map((row) => (row.selectedArtifactIds.length === 0 ? 1 : 0))
    ),
  };
}
