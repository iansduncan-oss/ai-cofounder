import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Ollama provider — local LLM inference via OpenAI-compatible API.
 * Ollama doesn't require an API key; availability is based on OLLAMA_BASE_URL being set.
 *
 * Default: http://localhost:11434/v1 (Ollama's built-in OpenAI endpoint)
 */
export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(baseURL: string | undefined, defaultModel?: string) {
    const url = baseURL || "http://localhost:11434/v1";
    // Ollama doesn't need a real API key but OpenAI SDK requires one.
    // Pass "ollama" as dummy key; use baseURL presence to control availability.
    super("ollama", baseURL ? "ollama" : undefined, defaultModel ?? "llama3.2", url);
  }
}
