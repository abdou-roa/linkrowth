import type { LlmProvider } from "../llm/types";
import { loadEnv } from "./env";

export interface ProviderConfig {
  apiKey: string;
  defaultModel: string;
  embedModel: string;
  apiKeyEnvVar: string;
}

interface LlmEnvConfig {
  provider: LlmProvider;
  openai: ProviderConfig;
  gemini: ProviderConfig;
}

const PROVIDERS: LlmProvider[] = ["openai", "gemini"];

const PROVIDER_ENV_VARS: Record<LlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

const DEFAULT_EMBED_MODELS: Record<LlmProvider, string> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
};

const MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_MODEL",
  gemini: "LINKROWTH_GEMINI_MODEL",
};

const EMBED_MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_EMBED_MODEL",
  gemini: "LINKROWTH_GEMINI_EMBED_MODEL",
};

let cached: LlmEnvConfig | null = null;

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
    embedModel:
      process.env[EMBED_MODEL_ENV_VARS[provider]]?.trim() ??
      DEFAULT_EMBED_MODELS[provider],
    apiKeyEnvVar: PROVIDER_ENV_VARS[provider],
  };
}

function getEnv(): LlmEnvConfig {
  if (cached) return cached;

  loadEnv();

  cached = {
    provider: readProvider(process.env.LINKROWTH_PROVIDER),
    openai: buildProviderConfig("openai"),
    gemini: buildProviderConfig("gemini"),
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
        "Copy distill/.env.example to distill/.env and add your API key."
    );
  }

  return { provider: env.provider, ...config };
}
