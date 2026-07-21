import { existsSync } from "node:fs";
import { join } from "node:path";

function isAgentRoot(dir: string): boolean {
  // Dev layout has src/; Docker/production copies only dist/ + config/.
  return (
    existsSync(join(dir, "package.json")) &&
    (existsSync(join(dir, "src", "engage.ts")) ||
      existsSync(join(dir, "dist", "engage.js")))
  );
}

/** Resolve the agent package root (…/linkrowth/agent). */
export function getAgentRoot(): string {
  const fromEnv = process.env.LINKROWTH_AGENT_ROOT?.trim();
  if (fromEnv && isAgentRoot(fromEnv)) {
    return fromEnv;
  }

  // Works when agent code is imported from another package (e.g. api → @linkrowth/agent).
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (isAgentRoot(dir)) {
      return dir;
    }
    dir = join(dir, "..");
  }

  dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (isAgentRoot(dir)) {
      return dir;
    }
    const nested = join(dir, "agent");
    if (isAgentRoot(nested)) {
      return nested;
    }
    dir = join(dir, "..");
  }

  return process.cwd();
}
