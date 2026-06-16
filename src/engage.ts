import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngagePrompt } from "./prompts";
import { call } from "./llm";
import type { EngageResult, Post, UserContext } from "./types";

function loadUserContext(): UserContext {
  const configPath = join(process.cwd(), "config", "user.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "Missing config/user.json. Copy config/user.example.json and fill in your niche, positioning, and target audience."
    );
  }

  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as UserContext;
}

function parseEngageResponse(text: string): EngageResult {
  const suggestionMatch = text.match(
    /Suggestion:\s*\n([\s\S]*?)(?:\n\nWhy:|\nWhy:)/
  );
  const rationaleMatch = text.match(/Why:\s*\n?([\s\S]+)$/);

  if (!suggestionMatch || !rationaleMatch) {
    throw new Error("Could not parse LLM response — expected Suggestion and Why sections");
  }

  return {
    suggestion: suggestionMatch[1].trim(),
    rationale: rationaleMatch[1].trim(),
  };
}

export async function engage(post: Post, context?: UserContext): Promise<EngageResult> {
  const userContext = context ?? loadUserContext();
  const prompt = buildEngagePrompt(post, userContext);
  const response = await call(prompt);
  return parseEngageResponse(response);
}
