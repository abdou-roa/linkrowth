import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgent } from "../agents/registry";
import { getAgentRoot } from "../paths";
import type { Post, UserContext } from "../types";
import { createPostgresRunRepository } from "./postgresRepository";
import type { RunRecord, RunRepository } from "./types";

export function loadUserContext(): UserContext {
  const configPath = join(getAgentRoot(), "config", "user.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing agent/config/user.json. Copy agent/config/user.example.json and fill in your niche, positioning, and target audience."
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
  const repository = options.repository ?? createPostgresRunRepository();
  const agent = getAgent(options.agentId);

  const agentResult = await agent.run({ post, context });

  const postId = post.id ?? randomUUID();
  const createdAt = new Date().toISOString();

  const record: RunRecord = {
    id: randomUUID(),
    postId,
    agentId: agentResult.agentId,
    post: { ...post, id: postId },
    result: agentResult.result,
    steps: agentResult.steps,
    createdAt,
  };

  return repository.save(record);
}
