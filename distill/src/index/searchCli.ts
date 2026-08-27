import { embedQuery } from "../llm";
import { getActiveProviderConfig } from "../config/llm";
import { dataPath } from "../paths";
import { envInt } from "../util/pool";
import { loadIndex, rankIndex } from "./store";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    throw new Error('Usage: npm run search -- "vector stores drift once write throughput…"');
  }

  const indexPath = dataPath("experience-index.db");
  const index = loadIndex(indexPath);
  if (!index?.items?.length) {
    throw new Error(
      "No index. Run npm run distill && npm run index first (expected data/experience-index.db)."
    );
  }

  const { provider, embedModel } = getActiveProviderConfig();
  if (index.embedding.provider && index.embedding.provider !== provider) {
    console.warn(
      `Warning: index was built with ${index.embedding.provider}/${index.embedding.model}; searching with ${provider}/${embedModel}.`
    );
  }

  const k = envInt("SEARCH_K", 5);
  const vector = await embedQuery(query);
  const hits = rankIndex(index, vector, k);

  console.log(`Top ${hits.length} for: ${query}\n`);
  for (const [i, hit] of hits.entries()) {
    const a = hit.artifact;
    console.log(`${i + 1}. ${a.title}  (${hit.score.toFixed(3)})`);
    console.log(`   ${a.repo} · ${a.shareability} · ${a.confidence}`);
    console.log(`   ${a.claimableLine}`);
    if (a.domains.length) console.log(`   domains: ${a.domains.join(", ")}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
