import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Shared secret for extension → API Bearer auth. Empty = auth not configured. */
  apiKey: process.env.API_KEY?.trim() ?? "",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Start Postgres (`docker compose up -d postgres`), copy DATABASE_URL from .env.example into .env."
    );
  }
  return url;
}

export function validateEnv(): void {
  getDatabaseUrl();
}
