import { Pool } from "pg";
import { loadEnv } from "./loadEnv";

export function getDatabaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Start Postgres (`docker compose up -d postgres`), copy DATABASE_URL from .env.example into .env, then run `./helpers/migrate.sh`."
    );
  }
  return url;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return pool;
}
