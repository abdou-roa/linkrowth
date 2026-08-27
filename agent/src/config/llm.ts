import type { LlmProvider } from "../llm/types";
import { loadEnv } from "./loadEnv";

export interface ProviderConfig {
  apiKey: string;
  defaultModel: string;
  /** Stronger model for analysis; falls back to DEFAULT_ANALYZE_MODELS when unset. */
  analyzeModel: string;
  /** Stronger model for comment drafting; falls back to defaultModel when unset. */
  draftModel: string;
  apiKeyEnvVar: string;
}

/** Multi-step roles that can select a model. Refiner uses the default. */
export type EngageLlmStep = "analyze" | "draft" | "refine";

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

const DEFAULT_ANALYZE_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5.4",
  gemini: "gemini-2.5-pro",
};

const MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_MODEL",
  gemini: "LINKROWTH_GEMINI_MODEL",
};

const ANALYZE_MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_ANALYZE_MODEL",
  gemini: "LINKROWTH_GEMINI_ANALYZE_MODEL",
};

const DRAFT_MODEL_ENV_VARS: Record<LlmProvider, string> = {
  openai: "LINKROWTH_OPENAI_DRAFT_MODEL",
  gemini: "LINKROWTH_GEMINI_DRAFT_MODEL",
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
  const defaultModel =
    process.env[MODEL_ENV_VARS[provider]]?.trim() ?? DEFAULT_MODELS[provider];

  return {
    apiKey: process.env[PROVIDER_ENV_VARS[provider]]?.trim() ?? "",
    defaultModel,
    analyzeModel:
      process.env[ANALYZE_MODEL_ENV_VARS[provider]]?.trim() ||
      DEFAULT_ANALYZE_MODELS[provider],
    draftModel:
      process.env[DRAFT_MODEL_ENV_VARS[provider]]?.trim() || defaultModel,
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
        "Copy .env.example to .env and add your API key."
    );
  }

  return { provider: env.provider, ...config };
}

/** Model for a multi-step role. Analyze and draft may be stronger; refine uses the default. */
export function getStepModel(step: EngageLlmStep): string {
  const { defaultModel, analyzeModel, draftModel } = getActiveProviderConfig();
  if (step === "analyze") return analyzeModel;
  if (step === "draft") return draftModel;
  return defaultModel;
}
