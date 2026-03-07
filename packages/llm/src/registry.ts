import { createLogger } from "@ai-cofounder/shared";
import type { LlmProvider } from "./provider.js";
import type { LlmCompletionRequest, LlmCompletionResponse, TaskCategory } from "./types.js";

interface ModelRoute {
  provider: string;
  model: string;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  recentErrors: Array<{ time: string; message: string }>;
  lastSuccessAt?: string;
  lastErrorAt?: string;
}

export interface ProviderStatsSnapshot {
  providerName: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  lastErrorMessage?: string;
  lastErrorAt?: Date;
  lastSuccessAt?: Date;
}

interface ProviderStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  totalLatencyMs: number;
  recentErrors: Array<{ time: Date; message: string }>;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
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
  private stats = new Map<string, ProviderStats>();

  constructor(routes?: Record<TaskCategory, ModelRoute[]>) {
    this.routes = routes ?? DEFAULT_ROUTES;
  }

  private getStats(provider: string): ProviderStats {
    let s = this.stats.get(provider);
    if (!s) {
      s = { totalRequests: 0, successCount: 0, errorCount: 0, totalLatencyMs: 0, recentErrors: [] };
      this.stats.set(provider, s);
    }
    return s;
  }

  private recordSuccess(provider: string, latencyMs: number): void {
    const s = this.getStats(provider);
    s.totalRequests++;
    s.successCount++;
    s.totalLatencyMs += latencyMs;
    s.lastSuccessAt = new Date();
  }

  private recordError(provider: string, message: string): void {
    const s = this.getStats(provider);
    s.totalRequests++;
    s.errorCount++;
    s.lastErrorAt = new Date();
    s.recentErrors.push({ time: new Date(), message });
    // Keep only last 10 errors
    if (s.recentErrors.length > 10) s.recentErrors.shift();
  }

  /** Get health status for all registered providers */
  getProviderHealth(): ProviderHealth[] {
    return Array.from(this.providers.values()).map((p) => {
      const s = this.stats.get(p.name) ?? {
        totalRequests: 0, successCount: 0, errorCount: 0, totalLatencyMs: 0, recentErrors: [],
      };
      return {
        provider: p.name,
        available: p.available,
        totalRequests: s.totalRequests,
        successCount: s.successCount,
        errorCount: s.errorCount,
        avgLatencyMs: s.successCount > 0 ? Math.round(s.totalLatencyMs / s.successCount) : 0,
        recentErrors: s.recentErrors.map((e) => ({ time: e.time.toISOString(), message: e.message })),
        lastSuccessAt: s.lastSuccessAt?.toISOString(),
        lastErrorAt: s.lastErrorAt?.toISOString(),
      };
    });
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

        const start = Date.now();
        const response = await provider.complete({
          ...request,
          model: route.model,
        });
        const latencyMs = Date.now() - start;

        this.recordSuccess(route.provider, latencyMs);

        this.logger.info(
          {
            task,
            provider: route.provider,
            model: response.model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            latencyMs,
          },
          "completion succeeded",
        );

        return { ...response, provider: route.provider };
      } catch (err) {
        this.recordError(route.provider, err instanceof Error ? err.message : String(err));
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

  /** Export current stats as snapshots for DB persistence */
  getStatsSnapshots(): ProviderStatsSnapshot[] {
    return Array.from(this.stats.entries()).map(([providerName, s]) => ({
      providerName,
      requestCount: s.totalRequests,
      successCount: s.successCount,
      errorCount: s.errorCount,
      avgLatencyMs: s.successCount > 0 ? Math.round(s.totalLatencyMs / s.successCount) : 0,
      lastErrorMessage: s.recentErrors.length > 0
        ? s.recentErrors[s.recentErrors.length - 1].message
        : undefined,
      lastErrorAt: s.lastErrorAt,
      lastSuccessAt: s.lastSuccessAt,
    }));
  }

  /** Seed in-memory stats from persisted data (call on startup) */
  seedStats(snapshots: ProviderStatsSnapshot[]): void {
    for (const snap of snapshots) {
      const existing = this.stats.get(snap.providerName);
      if (!existing || existing.totalRequests === 0) {
        this.stats.set(snap.providerName, {
          totalRequests: snap.requestCount,
          successCount: snap.successCount,
          errorCount: snap.errorCount,
          totalLatencyMs: snap.avgLatencyMs * snap.successCount,
          recentErrors: [],
          lastSuccessAt: snap.lastSuccessAt,
          lastErrorAt: snap.lastErrorAt,
        });
        this.logger.info({ provider: snap.providerName, requests: snap.requestCount }, "seeded stats from DB");
      }
    }
  }
}
