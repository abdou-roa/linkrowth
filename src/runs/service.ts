import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgent } from "../agents/registry";
import type { Post, UserContext } from "../types";
import { defaultRunRepository } from "./memoryRepository";
import type { RunRecord, RunRepository } from "./types";

export function loadUserContext(): UserContext {
  const configPath = join(process.cwd(), "config", "user.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing config/user.json. Copy config/user.example.json and fill in your niche, positioning, and target audience."
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as UserContext;
}

export interface RunEngageOptions {
  context?: UserContext;
  repository?: RunRepository;
  agentId?: string;
}

export async function runEngage(
  post: Post,
  options: RunEngageOptions = {}
): Promise<RunRecord> {
  const context = options.context ?? loadUserContext();
  const repository = options.repository ?? defaultRunRepository;
  const agent = getAgent(options.agentId);

  const agentResult = await agent.run({ post, context });

  const record: RunRecord = {
    id: randomUUID(),
    agentId: agentResult.agentId,
    post,
    result: agentResult.result,
    steps: agentResult.steps,
    createdAt: new Date().toISOString(),
  };

  return repository.save(record);
}
