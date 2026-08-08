import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { getAgentRoot } from "../paths";

let loaded = false;

/** Load agent/.env exactly once. Called explicitly by config readers, not on import. */
export function loadEnv(): void {
  if (loaded) return;
  loadDotenv({ path: resolve(getAgentRoot(), ".env") });
  loaded = true;
}
