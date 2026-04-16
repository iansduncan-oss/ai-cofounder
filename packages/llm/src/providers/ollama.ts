import type { LlmCompletionRequest, LlmCompletionResponse } from "../types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Ollama provider — local LLM inference via OpenAI-compatible API.
 * Always available, never runs out of credits. Used as fallback when cloud providers are exhausted.
 *
 * Overrides: longer timeout (5 min for CPU inference), strips tools (local models
 * don't handle function calling reliably), caps max_tokens for faster responses.
 */
export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(baseURL: string | undefined, defaultModel?: string) {
    const url = baseURL || "http://localhost:11434/v1";
    super("ollama", baseURL ? "ollama" : undefined, defaultModel ?? "llama3.2:3b", url, 300_000);
  }

  override async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const stripped: LlmCompletionRequest = {
      ...request,
      tools: undefined,
      max_tokens: Math.min(request.max_tokens ?? 2048, 2048),
    };
    return super.complete(stripped);
  }
}
