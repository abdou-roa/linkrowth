import { initObservability } from "@linkrowth/agent/observability";
import { createApp } from "./app";
import { env, validateEnv } from "./config/env";
import { closePool } from "./db/client";

// Patch LLM SDKs before in-process engage runs (must precede first LLM call).
initObservability();
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
