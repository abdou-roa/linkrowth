import dotenv from "dotenv";
import { getDatabaseUrl } from "@linkrowth/db";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  /** Shared secret for extension → API Bearer auth. Empty = auth not configured. */
  apiKey: process.env.API_KEY?.trim() ?? "",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};

export function validateEnv(): void {
  getDatabaseUrl();
}
