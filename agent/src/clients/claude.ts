import type { LlmRequest } from "../types";

export async function call(_request: LlmRequest): Promise<string> {
  throw new Error("Anthropic client not implemented");
}
