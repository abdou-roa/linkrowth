import { dataPath } from "../paths";
import { envInt } from "../util/pool";
import { buildFts5Query } from "./fts";
import { loadIndex, rankByLexical, rankBySituation, rankIndex } from "./store";

type Channel = "single" | "situation" | "evidence" | "lexical";

function resolveChannel(args: string[]): { query: string; channel: Channel } {
  let channel: Channel = "single";
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--channel" && i + 1 < args.length) {
      const value = args[++i]!;
      if (value === "situation" || value === "evidence" || value === "single" || value === "lexical") {
        channel = value;
      } else {
        console.warn(`Unknown --channel value "${value}". Using "single".`);
      }
    } else {
      queryParts.push(arg!);
    }
  }

  return { query: queryParts.join(" ").trim(), channel };
}

async function main(): Promise<void> {
  const { query, channel } = resolveChannel(process.argv.slice(2));

  if (!query) {
    throw new Error(
      'Usage: npm run search -- [--channel single|situation|evidence|lexical] "your query text"'
    );
  }

  const indexPath = dataPath("experience-index.db");
  const index = loadIndex(indexPath);
  if (!index?.items?.length) {
    throw new Error(
      "No index. Run npm run distill && npm run index first (expected data/experience-index.db)."
    );
  }

  const k = envInt("SEARCH_K", 5);

  if (channel === "lexical") {
    const ftsQuery = buildFts5Query(query);
    const hits = rankByLexical(indexPath, ftsQuery, k);
    console.log(`Top ${hits.length} for: ${query}`);
    console.log(`Channel: BM25 lexical  (index v${index.schemaVersion})\n`);
    for (const [i, hit] of hits.entries()) {
      const a = hit.artifact;
      console.log(`${i + 1}. ${a.title}  (bm25: ${hit.bm25Score.toFixed(3)})`);
      console.log(`   ${a.repo} · ${a.shareability} · ${a.confidence}`);
      console.log(`   ${a.claimableLine}`);
      if (a.domains.length) console.log(`   domains: ${a.domains.join(", ")}`);
      console.log("");
    }
    return;
  }

  const { embedQuery } = await import("../llm");
  const { getActiveProviderConfig } = await import("../config/llm");
  const { provider, embedModel } = getActiveProviderConfig();
  if (index.embedding.provider && index.embedding.provider !== provider) {
    console.warn(
      `Warning: index was built with ${index.embedding.provider}/${index.embedding.model}; searching with ${provider}/${embedModel}.`
    );
  }

  const vector = await embedQuery(query);

  const hits =
    channel === "situation"
      ? rankBySituation(index, vector, k)
      : rankIndex(index, vector, k);

  const channelLabel =
    channel === "situation"
      ? "situation cosine"
      : channel === "evidence"
        ? "evidence cosine (not yet ranked — showing single-vector fallback)"
        : "single-vector cosine";

  console.log(`Top ${hits.length} for: ${query}`);
  console.log(`Channel: ${channelLabel}  (index v${index.schemaVersion})\n`);

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
