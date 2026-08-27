import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentRoot } from "../paths";
import type { UserContext } from "../core/types";

/**
 * Static context assembly: read the whole persona from config/user.json.
 * Online retrieval enriches this via retrieveContext(post, base) — see
 * retrieveContext.ts — without touching the engage core.
 */
export function loadUserContext(): UserContext {
  const configPath = join(getAgentRoot(), "config", "user.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing agent/config/user.json. Copy agent/config/user.example.json and fill in your identity, voice, and substance fields."
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as UserContext;
}
