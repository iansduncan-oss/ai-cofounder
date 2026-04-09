import type { LlmCompletionRequest, LlmCompletionResponse } from "../types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Ollama provider — local LLM inference via OpenAI-compatible API.
 * Ollama doesn't require an API key; availability is based on OLLAMA_BASE_URL being set.
 *
 * Overrides: longer timeout (5 min for CPU inference), strips tools (small models
 * don't handle tool use reliably), and caps context to keep CPU latency reasonable.
 */
export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(baseURL: string | undefined, defaultModel?: string) {
    const url = baseURL || "http://localhost:11434/v1";
    super("ollama", baseURL ? "ollama" : undefined, defaultModel ?? "llama3.2:3b", url, 300_000); // 5 min timeout for CPU
  }

  override async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    // Strip tools — small local models don't handle function calling well
    // and tool definitions bloat the prompt significantly
    const stripped: LlmCompletionRequest = {
      ...request,
      tools: undefined,
      max_tokens: Math.min(request.max_tokens ?? 1024, 1024),
    };
    return super.complete(stripped);
  }
}
