#!/usr/bin/env node
import { closePool, getDatabaseUrl } from "@linkrowth/db";
import { getActiveProviderConfig } from "./config/llm";
import { createInterface } from "node:readline";
import { stdin } from "node:process";
import { runEngageWithStatus } from "./persistence/runEngage";

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
  const outcome = await runEngageWithStatus({ text });

  if (outcome.kind === "awaiting_clarification") {
    console.log("\nAwaiting clarification:");
    console.log(outcome.clarification.question);
    if (outcome.clarification.reason) {
      console.log(`\nWhy: ${outcome.clarification.reason}`);
    }
    console.log(
      "\n(Workflow paused. Resume support: pass an answered clarification into the agent.)"
    );
    return;
  }

  const { result, steps } = outcome.run;
  console.log("\nCategory:");
  console.log(result.category);
  console.log("\nSuggestion:");
  console.log(result.suggestion);
  console.log("\nWhy:");
  console.log(result.rationale);

  if (steps.length > 0) {
    console.log("\nSteps:");
    for (const step of steps) {
      console.log(`- ${step.name} [${step.status}] ${step.summary ?? ""}`);
      if (step.output !== undefined) {
        console.log(JSON.stringify(step.output, null, 2));
      }
    }
  }
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
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
