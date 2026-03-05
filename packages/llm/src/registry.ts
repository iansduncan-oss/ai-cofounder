import { createLogger } from "@ai-cofounder/shared";
import type { LlmProvider } from "./provider.js";
import type { LlmCompletionRequest, LlmCompletionResponse, TaskCategory } from "./types.js";

interface ModelRoute {
  provider: string;
  model: string;
}

/**
 * Task-based model routing with fallback chains.
 *
 * Each task category maps to an ordered list of (provider, model) pairs.
 * The registry tries each in order, falling back on provider unavailability or error.
 */
const DEFAULT_ROUTES: Record<TaskCategory, ModelRoute[]> = {
  planning: [
    { provider: "anthropic", model: "claude-opus-4-20250901" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "gemini", model: "gemini-2.5-pro" },
  ],
  conversation: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ],
  simple: [
    { provider: "groq", model: "llama-3.1-8b-instant" },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  research: [
    { provider: "gemini", model: "gemini-2.5-flash" },
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ],
  code: [
    { provider: "anthropic", model: "claude-sonnet-4-20250514" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
  ],
};

export class LlmRegistry {
  private providers = new Map<string, LlmProvider>();
  private routes: Record<TaskCategory, ModelRoute[]>;
  private logger = createLogger("llm-registry");

  constructor(routes?: Record<TaskCategory, ModelRoute[]>) {
    this.routes = routes ?? DEFAULT_ROUTES;
  }

  register(provider: LlmProvider): void {
    this.providers.set(provider.name, provider);
    this.logger.info(
      { provider: provider.name, available: provider.available },
      "provider registered",
    );
  }

  getProvider(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  /** Get the first available provider for a task category */
  resolveProvider(task: TaskCategory): { provider: LlmProvider; model: string } | null {
    const chain = this.routes[task];
    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (provider?.available) {
        return { provider, model: route.model };
      }
    }
    return null;
  }

  /** Complete a request using task-based routing with automatic fallback */
  async complete(
    task: TaskCategory,
    request: Omit<LlmCompletionRequest, "model">,
  ): Promise<LlmCompletionResponse & { provider: string }> {
    const chain = this.routes[task];
    const errors: Array<{ provider: string; model: string; error: unknown }> = [];

    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (!provider?.available) continue;

      try {
        this.logger.info(
          { task, provider: route.provider, model: route.model },
          "attempting completion",
        );

        const response = await provider.complete({
          ...request,
          model: route.model,
        });

        this.logger.info(
          {
            task,
            provider: route.provider,
            model: response.model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          },
          "completion succeeded",
        );

        return { ...response, provider: route.provider };
      } catch (err) {
        this.logger.warn(
          { task, provider: route.provider, model: route.model, err },
          "provider failed, trying next",
        );
        errors.push({ provider: route.provider, model: route.model, error: err });
      }
    }

    throw new Error(
      `All providers exhausted for task "${task}". Errors: ${errors
        .map((e) => `${e.provider}/${e.model}: ${e.error}`)
        .join("; ")}`,
    );
  }

  /** Direct completion using a specific provider (no routing) */
  async completeDirect(
    providerName: string,
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResponse> {
    const provider = this.providers.get(providerName);
    if (!provider?.available) {
      throw new Error(`Provider "${providerName}" not available`);
    }
    return provider.complete(request);
  }

  /** List all registered providers and their availability */
  listProviders(): Array<{ name: string; available: boolean; defaultModel: string }> {
    return Array.from(this.providers.values()).map((p) => ({
      name: p.name,
      available: p.available,
      defaultModel: p.defaultModel,
    }));
  }
}
