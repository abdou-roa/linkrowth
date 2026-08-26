import { embed } from "../llm";
import { getActiveProviderConfig } from "../config/llm";
import { dataPath } from "../paths";
import type { ExperienceArtifact, ExperienceIndex } from "../types";
import { loadJson, writeJson } from "../util/jsonFile";
import { buildIndex } from "./store";

interface ArtifactsFile {
  artifacts?: ExperienceArtifact[];
}

async function main(): Promise<void> {
  const artifactsPath = dataPath("artifacts.json");
  const artifactsFile = loadJson<ArtifactsFile>(artifactsPath);
  const artifacts = artifactsFile?.artifacts ?? [];

  if (artifacts.length === 0) {
    throw new Error(
      "Nothing to index. Run npm run distill first (expected data/artifacts.json)."
    );
  }

  const { provider, embedModel } = getActiveProviderConfig();
  console.log(
    `Indexing ${artifacts.length} artifact(s) with ${provider}/${embedModel}…`
  );

  const index = await buildIndex(artifacts, embed, {
    provider,
    model: embedModel,
    dimensions: 0,
  });

  const indexPath = dataPath("experience-index.json");
  writeJson(indexPath, index);

  console.log(`Indexed ${index.count} vector(s), dim=${index.embedding.dimensions}`);
  console.log(`  index → ${indexPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
