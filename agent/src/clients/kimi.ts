import type { LlmRequest } from "../types";

export async function call(_request: LlmRequest): Promise<string> {
  throw new Error("Kimi client not implemented");
}
