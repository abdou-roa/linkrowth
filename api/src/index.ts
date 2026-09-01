import { closePool } from "@linkrowth/db";
import { createApp } from "./app";
import { env, validateEnv } from "./config/env";

validateEnv();

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`[api] listening on :${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
