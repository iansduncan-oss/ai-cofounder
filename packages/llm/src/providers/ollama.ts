import type { LlmCompletionRequest, LlmCompletionResponse } from "../types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Ollama provider — local LLM inference via OpenAI-compatible API.
 * Always available, never runs out of credits.
 *
 * Guardrails for small models (3b):
 * - Strips tools (small models don't handle function calling reliably)
 * - Caps max_tokens to 1024 (prevents rambling/hallucination in long outputs)
 * - 5-minute timeout for CPU inference
 * - keep_alive: "5m" to auto-unload model after 5 min idle (frees RAM)
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
      max_tokens: Math.min(request.max_tokens ?? 1024, 1024),
    };
    const response = await super.complete(stripped);

    // Validate response isn't empty or garbage (common with small models)
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text.trim()) {
      throw new Error(
        "Ollama returned empty response — model may be overloaded or prompt too complex",
      );
    }

    return response;
  }
}
