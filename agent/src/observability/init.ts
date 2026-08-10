import Openlit from "openlit";
import { loadEnv } from "../config/loadEnv";

let initialized = false;

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    headers[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Whether OpenLIT should be initialized for this process. */
export function isObservabilityEnabled(): boolean {
  loadEnv();
  const explicit = envFlag("LINKROWTH_OPENLIT");
  if (explicit === false) return false;
  if (explicit === true) return true;
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

/**
 * Initialize OpenLIT once per process. Safe to call from CLI and API entrypoints.
 * No-ops when disabled (see LINKROWTH_OPENLIT / OTEL_EXPORTER_OTLP_ENDPOINT).
 *
 * Must run before the first LLM client call so provider auto-instrumentation
 * can patch the OpenAI / Google SDKs.
 */
export function initObservability(): void {
  if (initialized) return;
  loadEnv();

  if (!isObservabilityEnabled()) {
    initialized = true;
    return;
  }

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const captureMessageContent = envFlag("LINKROWTH_OPENLIT_CAPTURE_CONTENT") ?? true;

  const applicationName =
    process.env.OTEL_SERVICE_NAME?.trim() ||
    process.env.LINKROWTH_OPENLIT_APP_NAME?.trim() ||
    "linkrowth-agent";
  const environment =
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development";

  Openlit.init({
    applicationName,
    environment,
    otlpEndpoint: otlpEndpoint || undefined,
    otlpHeaders: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    captureMessageContent,
    disableBatch: envFlag("LINKROWTH_OPENLIT_DISABLE_BATCH") ?? true,
  });

  if (otlpEndpoint) {
    console.log(
      `[observability] OpenLIT SDK enabled → OTLP ${otlpEndpoint} (app=${applicationName}, env=${environment})`
    );
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(otlpEndpoint)) {
      console.warn(
        "[observability] OTEL endpoint is localhost. Inside Docker that is the API container itself — traces will not reach a collector on your host. Use host.docker.internal or a compose service name."
      );
    }
  } else {
    console.log(
      `[observability] OpenLIT SDK enabled → console exporter (app=${applicationName}, env=${environment})`
    );
  }

  initialized = true;
}
