import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[api] listening on :${env.port} (${env.nodeEnv})`);
});
