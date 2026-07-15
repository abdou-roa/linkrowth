import { existsSync } from "node:fs";
import { join } from "node:path";

/** Resolve the agent package root (…/linkrowth/agent). */
export function getAgentRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "src", "engage.ts"))
    ) {
      return dir;
    }
    if (existsSync(join(dir, "agent", "src", "engage.ts"))) {
      return join(dir, "agent");
    }
    dir = join(dir, "..");
  }
  return process.cwd();
}
