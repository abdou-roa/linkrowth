/**
 * Phase 2 retrieval baseline comparison harness (scaffold).
 *
 * Compares LINKROWTH_RETRIEVAL_STRATEGY=single vs split over a labeled JSONL
 * dataset. See docs/retrieval-phase-2-eval.md for the full spec.
 *
 * Usage (once implemented):
 *   npm run eval:retrieval -- [--dataset path] [--index path] [--k 5] [--fixture]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentRoot } from "../paths";

export interface Phase2EvalRow {
  id: string;
  post: { text: string; author?: { headline?: string } };
  analysis?: Record<string, unknown>;
  relevantSituationIds: string[];
  applicableEvidenceIds: string[];
  safeToInjectIds: string[];
  shouldAbstain: boolean;
  hardNegativeIds: string[];
}

export interface EvalCliOptions {
  datasetPath: string;
  indexPath: string;
  k: number;
  minScore: number;
  candidatePoolSize?: number;
  recallN: number;
  fixture: boolean;
  json: boolean;
}

const DEFAULT_DATASET = resolve(
  getAgentRoot(),
  "../distill/data/eval/phase2.jsonl"
);
const DEFAULT_FIXTURE = resolve(
  __dirname,
  "__fixtures__/phase2-eval.sample.jsonl"
);
const DEFAULT_INDEX = resolve(
  getAgentRoot(),
  "../distill/data/experience-index.db"
);

export function parseArgs(argv: string[]): EvalCliOptions {
  let datasetPath = DEFAULT_DATASET;
  let indexPath = DEFAULT_INDEX;
  let k = 5;
  let minScore = 0.3;
  let candidatePoolSize: number | undefined;
  let recallN = 20;
  let fixture = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dataset" && next) {
      datasetPath = resolve(next);
      i++;
    } else if (arg === "--index" && next) {
      indexPath = resolve(next);
      i++;
    } else if (arg === "--k" && next) {
      k = Number(next);
      i++;
    } else if (arg === "--min-score" && next) {
      minScore = Number(next);
      i++;
    } else if (arg === "--pool" && next) {
      candidatePoolSize = Number(next);
      i++;
    } else if (arg === "--recall-n" && next) {
      recallN = Number(next);
      i++;
    } else if (arg === "--fixture") {
      fixture = true;
      datasetPath = DEFAULT_FIXTURE;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return {
    datasetPath,
    indexPath,
    k,
    minScore,
    candidatePoolSize,
    recallN,
    fixture,
    json,
  };
}

export function loadDataset(path: string): Phase2EvalRow[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Phase2EvalRow;
      } catch {
        throw new Error(`Invalid JSON on line ${index + 1} of ${path}`);
      }
    });
}

function printUsage(): void {
  console.log(`Phase 2 retrieval baseline comparison (scaffold — not yet implemented)

Usage:
  npm run eval:retrieval -- [options]

Options:
  --dataset <path>   Labeled JSONL (default: distill/data/eval/phase2.jsonl)
  --index <path>     experience-index.db (default: distill/data/experience-index.db)
  --k <n>            Max injected hits (default: 5)
  --min-score <n>    Cosine floor (default: 0.3)
  --pool <n>         Split-strategy candidate pool override
  --recall-n <n>     N for recall@N (default: 20)
  --fixture          Use agent/src/context/__fixtures__/phase2-eval.sample.jsonl
  --json             Machine-readable output
  -h, --help         Show this help

Spec: docs/retrieval-phase-2-eval.md
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // Scaffold: validate dataset loads, then exit with instructions.
  let rows: Phase2EvalRow[];
  try {
    rows = loadDataset(options.datasetPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load dataset: ${message}`);
    console.error("\nCreate a labeled set at distill/data/eval/phase2.jsonl");
    console.error("or run with --fixture to load the committed sample row.");
    console.error("\nSee docs/retrieval-phase-2-eval.md for the row schema.");
    process.exit(1);
  }

  console.error(
    `[retrievalEvalCli] Scaffold only — loaded ${rows.length} row(s) from ${options.datasetPath}`
  );
  console.error(
    "[retrievalEvalCli] TODO: run retrieveContext(single) and retrieveContext(split) per row, aggregate metrics."
  );
  console.error("See docs/retrieval-phase-2-eval.md for the implementation checklist.");

  if (options.json) {
    console.log(
      JSON.stringify({
        status: "scaffold",
        rowCount: rows.length,
        options,
      })
    );
  }

  process.exit(2);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
