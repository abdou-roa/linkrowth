import { config as loadDotenv } from "dotenv";
import { getDistillRoot } from "../paths";

let loaded = false;

/** Load distill/.env exactly once. Called by config readers, not on import. */
export function loadEnv(): void {
  if (loaded) return;
  loadDotenv({ path: `${getDistillRoot()}/.env` });
  loaded = true;
}
