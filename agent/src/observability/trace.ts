import Openlit, { type TracedSpan } from "openlit";

export type TraceAttributes = Record<string, string | number | boolean | undefined>;

function compactAttributes(
  attributes: TraceAttributes | undefined
): Record<string, string | number | boolean> | undefined {
  if (!attributes) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Run `fn` inside an OpenLIT/OTel CLIENT span so nested LLM auto-spans attach
 * as children. No-op-safe when OpenLIT was not initialized (OTel no-op tracer).
 */
export async function withTrace<T>(
  name: string,
  attributes: TraceAttributes | undefined,
  fn: (span: TracedSpan) => Promise<T>
): Promise<T> {
  return Openlit.startTrace(name, async (span) => {
    const attrs = compactAttributes(attributes);
    if (attrs) span.setMetadata(attrs);
    return fn(span);
  });
}
