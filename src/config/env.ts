import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import type { LlmProvider } from "../types";

loadDotenv({ path: resolve(process.cwd(), ".env") });

export interface ProviderConfig {
  apiKey: string;
  defaultModel: string;
  apiKeyEnvVar: string;
}

export interface EnvConfig {
  provider: LlmProvider;
  openai: ProviderConfig;
  gemini: ProviderConfig;
  anthropic: ProviderConfig;
  kimi: ProviderConfig;
}

const PROVIDERS: LlmProvider[] = ["openai", "gemini", "anthropic", "kimi"];

const PROVIDER_ENV_VARS: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  kimi: "KIMI_API_KEY",
};

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-sonnet-4-6",
  kimi: "moonshot-v1-8k",
};

const MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_MODEL",
  gemini: "LINKROWTH_GEMINI_MODEL",
  anthropic: "LINKROWTH_ANTHROPIC_MODEL",
  kimi: "LINKROWTH_KIMI_MODEL",
};

let cached: EnvConfig | null = null;

function readProvider(value: string | undefined): LlmProvider {
  const normalized = value?.trim().toLowerCase() ?? "openai";

  if (!PROVIDERS.includes(normalized as LlmProvider)) {
    throw new Error(
      `Invalid LINKROWTH_PROVIDER "${value}". Expected one of: ${PROVIDERS.join(", ")}`
    );
  }

  return normalized as LlmProvider;
}

function buildProviderConfig(provider: LlmProvider): ProviderConfig {
  return {
    apiKey: process.env[PROVIDER_ENV_VARS[provider]]?.trim() ?? "",
    defaultModel:
      process.env[MODEL_ENV_VARS[provider]]?.trim() ?? DEFAULT_MODELS[provider],
    apiKeyEnvVar: PROVIDER_ENV_VARS[provider],
  };
}

export function getEnv(): EnvConfig {
  if (cached) return cached;

  cached = {
    provider: readProvider(process.env.LINKROWTH_PROVIDER),
    openai: buildProviderConfig("openai"),
    gemini: buildProviderConfig("gemini"),
    anthropic: buildProviderConfig("anthropic"),
    kimi: buildProviderConfig("kimi"),
  };

  return cached;
}

export function getProviderConfig(provider: LlmProvider): ProviderConfig {
  return getEnv()[provider];
}

export function getActiveProviderConfig(): ProviderConfig & { provider: LlmProvider } {
  const env = getEnv();
  const config = env[env.provider];

  if (!config.apiKey) {
    throw new Error(
      `Missing ${config.apiKeyEnvVar} for provider "${env.provider}". ` +
        "Copy .env.example to .env and add your API key."
    );
  }

  return { provider: env.provider, ...config };
}

export function validateEnv(): void {
  getActiveProviderConfig();
}
