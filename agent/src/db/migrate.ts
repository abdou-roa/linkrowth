import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentRoot } from "../paths";
import { closePool, getPool } from "./client";

async function migrate(): Promise<void> {
  // Unified schema (posts, suggestion_jobs, suggestion_runs) — source of truth.
  const schemaPath = join(getAgentRoot(), "..", "helpers", "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  const pool = getPool();

  await pool.query(sql);
  console.log(
    "Migration complete: posts, suggestion_jobs, suggestion_runs ready."
  );
}

migrate()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
