import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Absolute path to the distill package root (…/linkrowth/distill). */
export function getDistillRoot(): string {
  // src/paths.ts → package root is one level up from src/
  return join(__dirname, "..");
}

export function getDataDir(): string {
  return join(getDistillRoot(), "data");
}

export function getConfigDir(): string {
  return join(getDistillRoot(), "config");
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function dataPath(...segments: string[]): string {
  return join(ensureDataDir(), ...segments);
}

export function configPath(...segments: string[]): string {
  return join(getConfigDir(), ...segments);
}

export function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}
