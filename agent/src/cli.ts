#!/usr/bin/env node
import { getActiveProviderConfig } from "./config/llm";
import { getDatabaseUrl } from "./config/db";
import { createInterface } from "node:readline";
import { stdin } from "node:process";
import { runEngage } from "./persistence/runEngage";

function validateEnv(): void {
  getActiveProviderConfig();
  getDatabaseUrl();
}

async function readPostFromStdin(): Promise<string> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (!text) {
      throw new Error("No post text provided");
    }
    return text;
  }

  const rl = createInterface({ input: stdin, output: process.stdout });
  console.log("Paste a post and press Enter (or Ctrl+D when done):");

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  const text = lines.join("\n").trim();
  if (!text) {
    throw new Error("No post text provided");
  }

  return text;
}

async function runEngageCommand(): Promise<void> {
  const text = await readPostFromStdin();
  const { result } = await runEngage({ text });

  console.log("\nCategory:");
  console.log(result.category);
  console.log("\nSuggestion:");
  console.log(result.suggestion);
  console.log("\nWhy:");
  console.log(result.rationale);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== "engage") {
    console.error("Usage: linkrowth engage");
    process.exit(1);
  }

  try {
    validateEnv();
    await runEngageCommand();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
