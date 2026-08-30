import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

let loaded = false;

/**
 * Load the process-local environment once without overriding injected values.
 * LINKROWTH_DB_ENV_FILE supports entrypoints launched outside their package root.
 */
export function loadDatabaseEnv(): void {
  if (loaded || process.env.DATABASE_URL?.trim()) {
    loaded = true;
    return;
  }

  const envFile =
    process.env.LINKROWTH_DB_ENV_FILE?.trim() || resolve(process.cwd(), ".env");
  loadDotenv({ path: envFile });
  loaded = true;
}

export function getDatabaseUrl(): string {
  loadDatabaseEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Start Postgres (`docker compose up -d postgres`), configure the current package .env, then run `./helpers/migrate.sh`."
    );
  }
  return url;
}
