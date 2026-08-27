import { existsSync, readFileSync } from "node:fs";
import { configPath } from "../paths";
import { loadEnv } from "./env";

loadEnv();

export type LocalRepoMode = "merges" | "linear";

export interface LocalRepoEntry {
  /** Absolute path to a git checkout on this machine */
  path: string;
  mode?: LocalRepoMode;
  /** For linear mode: e.g. "main" or "main..HEAD" */
  range?: string;
}

export interface LocalReposConfig {
  /** Passed to git log --author=… */
  author: string;
  repos: LocalRepoEntry[];
}

export interface GithubReposConfig {
  repos: string[];
}

function readJsonFile<T>(filePath: string, label: string): T {
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing ${label} at ${filePath}. Copy the matching *.example.json and edit absolute paths / repo list.`
    );
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function loadLocalReposConfig(): LocalReposConfig {
  const cfg = readJsonFile<LocalReposConfig>(
    configPath("repos.local.json"),
    "local repos config"
  );
  if (!cfg.author?.trim()) {
    throw new Error("repos.local.json: `author` is required (git --author filter).");
  }
  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    throw new Error("repos.local.json: `repos` must be a non-empty array.");
  }
  for (const entry of cfg.repos) {
    if (!entry.path?.trim()) {
      throw new Error("repos.local.json: each repo needs an absolute `path`.");
    }
  }
  return cfg;
}

export function loadGithubReposConfig(): GithubReposConfig {
  const cfg = readJsonFile<GithubReposConfig>(
    configPath("repos.github.json"),
    "GitHub repos config"
  );
  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    throw new Error("repos.github.json: `repos` must be a non-empty array of owner/name.");
  }
  for (const name of cfg.repos) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(name)) {
      throw new Error(`repos.github.json: invalid repo "${name}" (expected owner/name).`);
    }
  }
  return cfg;
}

export function getGithubToken(): string {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing GITHUB_TOKEN. Copy distill/.env.example to distill/.env and add a fine-grained PAT."
    );
  }
  return token;
}
