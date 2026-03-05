import type { LlmCompletionRequest, LlmCompletionResponse } from "./types.js";

export interface LlmProvider {
  /** Provider name (e.g., "anthropic", "groq") */
  readonly name: string;

  /** Default model ID for this provider */
  readonly defaultModel: string;

  /** Whether this provider is configured and available */
  readonly available: boolean;

  /** Send a completion request */
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
