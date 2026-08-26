import { call } from "../llm";
import { dataPath } from "../paths";
import type { ExperienceArtifact, RawExperienceCandidate } from "../types";
import { loadJson, writeJson } from "../util/jsonFile";
import { distillCandidates } from "./engine";

interface SanitizedFile {
  candidates?: RawExperienceCandidate[];
}

interface ArtifactsFile {
  distilledAt?: string;
  count?: number;
  artifacts?: ExperienceArtifact[];
}

function mainLog(done: number, total: number, kept: number, dropped: number): void {
  if (done === total || done % 10 === 0) {
    console.log(`  distill ${done}/${total} (kept ${kept}, dropped ${dropped})`);
  }
}

async function main(): Promise<void> {
  const sanitizedPath = dataPath("candidates.sanitized.json");
  const sanitized = loadJson<SanitizedFile>(sanitizedPath);
  const candidates = sanitized?.candidates ?? [];

  if (candidates.length === 0) {
    throw new Error(
      "Nothing to distill. Run npm run sanitize first (expected data/candidates.sanitized.json)."
    );
  }

  const artifactsPath = dataPath("artifacts.json");
  const droppedPath = dataPath("artifacts.dropped.json");
  const existingFile = loadJson<ArtifactsFile>(artifactsPath);

  console.log(`Distilling ${candidates.length} sanitized candidate(s)…`);

  const { artifacts, dropped } = await distillCandidates(candidates, {
    call,
    existingArtifacts: existingFile?.artifacts ?? [],
    onProgress: mainLog,
  });

  writeJson(artifactsPath, {
    distilledAt: new Date().toISOString(),
    count: artifacts.length,
    artifacts,
  });
  writeJson(droppedPath, {
    distilledAt: new Date().toISOString(),
    count: dropped.length,
    dropped,
  });

  console.log(
    `Distilled → kept ${artifacts.length} artifact(s), dropped ${dropped.length} this run`
  );
  console.log(`  artifacts → ${artifactsPath}`);
  console.log(`  dropped   → ${droppedPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
