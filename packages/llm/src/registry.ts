import { createLogger } from "@ai-cofounder/shared";
import type { LlmProvider } from "./provider.js";
import type { LlmCompletionRequest, LlmCompletionResponse, TaskCategory, CompletionMetadata } from "./types.js";

/** Data passed to the onCompletion callback after every successful complete() */
export interface CompletionEvent {
  task: TaskCategory;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicrodollars: number;
  metadata?: CompletionMetadata;
}

export type OnCompletionCallback = (event: CompletionEvent) => void | Promise<void>;

interface ModelRoute {
  provider: string;
  model: string;
}

/* ── Cost data (USD per 1M tokens) ── */

interface ModelCost {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_COSTS: Record<string, ModelCost> = {
  // Anthropic
  "claude-opus-4-20250901": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  // Groq (hosted Llama)
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },
  // OpenRouter (free tier)
  "meta-llama/llama-3.3-70b-instruct:free": { inputPer1M: 0, outputPer1M: 0 },
  // Gemini
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

/* ── Circuit breaker ── */

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreaker {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime?: Date;
  openUntil?: Date;
  halfOpenRequests: number;
}

const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxRequests: 2,
};

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
  private breakers = new Map<string, CircuitBreaker>();
  private totalCostMicrodollars = 0;

  /** Optional callback fired after every successful complete() call */
  onCompletion?: OnCompletionCallback;

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

  private getBreaker(provider: string): CircuitBreaker {
    let b = this.breakers.get(provider);
    if (!b) {
      b = { state: "closed", consecutiveFailures: 0, halfOpenRequests: 0 };
      this.breakers.set(provider, b);
    }
    return b;
  }

  private isCircuitOpen(provider: string): boolean {
    const b = this.getBreaker(provider);
    if (b.state === "closed") return false;
    if (b.state === "open") {
      if (b.openUntil && new Date() >= b.openUntil) {
        b.state = "half-open";
        b.halfOpenRequests = 0;
        this.logger.info({ provider }, "circuit breaker half-open, allowing probe requests");
        return false;
      }
      return true;
    }
    // half-open: allow up to N probe requests
    return b.halfOpenRequests >= CIRCUIT_BREAKER_DEFAULTS.halfOpenMaxRequests;
  }

  private recordSuccess(provider: string, latencyMs: number): void {
    const s = this.getStats(provider);
    s.totalRequests++;
    s.successCount++;
    s.totalLatencyMs += latencyMs;
    s.lastSuccessAt = new Date();

    // Reset circuit breaker on success
    const b = this.getBreaker(provider);
    if (b.state !== "closed") {
      this.logger.info({ provider, previousState: b.state }, "circuit breaker closed after success");
    }
    b.state = "closed";
    b.consecutiveFailures = 0;
    b.halfOpenRequests = 0;
  }

  private recordError(provider: string, message: string): void {
    const s = this.getStats(provider);
    s.totalRequests++;
    s.errorCount++;
    s.lastErrorAt = new Date();
    s.recentErrors.push({ time: new Date(), message });
    if (s.recentErrors.length > 10) s.recentErrors.shift();

    // Update circuit breaker
    const b = this.getBreaker(provider);
    b.consecutiveFailures++;
    b.lastFailureTime = new Date();

    if (b.state === "half-open") {
      // Failed during probe — reopen
      b.state = "open";
      b.openUntil = new Date(Date.now() + CIRCUIT_BREAKER_DEFAULTS.resetTimeoutMs);
      this.logger.warn({ provider }, "circuit breaker reopened after half-open failure");
    } else if (b.consecutiveFailures >= CIRCUIT_BREAKER_DEFAULTS.failureThreshold) {
      b.state = "open";
      b.openUntil = new Date(Date.now() + CIRCUIT_BREAKER_DEFAULTS.resetTimeoutMs);
      this.logger.warn(
        { provider, failures: b.consecutiveFailures },
        "circuit breaker opened",
      );
    }
  }

  /** Check if an error is transient and worth retrying */
  private isTransientError(err: unknown): boolean {
    return (
      err instanceof Error &&
      /rate.?limit|429|timeout|econnreset|socket hang up|503|overloaded/i.test(err.message)
    );
  }

  /** Estimate cost in microdollars for a completion */
  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const costs = MODEL_COSTS[model];
    if (!costs) return 0;
    const inputCost = (inputTokens / 1_000_000) * costs.inputPer1M * 1_000_000; // microdollars
    const outputCost = (outputTokens / 1_000_000) * costs.outputPer1M * 1_000_000;
    return Math.round(inputCost + outputCost);
  }

  /** Get estimated cost per request for a model (assumes ~1K in, ~500 out tokens) */
  getModelCost(model: string): ModelCost | undefined {
    return MODEL_COSTS[model];
  }

  /** Get cumulative session cost in microdollars */
  getTotalCost(): number {
    return this.totalCostMicrodollars;
  }

  /** Get circuit breaker state for all providers */
  getCircuitBreakerStates(): Array<{ provider: string; state: CircuitState; consecutiveFailures: number; openUntil?: string }> {
    return Array.from(this.breakers.entries()).map(([provider, b]) => ({
      provider,
      state: b.state,
      consecutiveFailures: b.consecutiveFailures,
      openUntil: b.openUntil?.toISOString(),
    }));
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
  ): Promise<LlmCompletionResponse & { provider: string; costMicrodollars: number }> {
    const chain = this.routes[task];
    const errors: Array<{ provider: string; model: string; error: unknown }> = [];

    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (!provider?.available) continue;

      // Circuit breaker check
      if (this.isCircuitOpen(route.provider)) {
        this.logger.info(
          { task, provider: route.provider },
          "skipping provider (circuit open)",
        );
        continue;
      }

      // Track half-open probe requests
      const breaker = this.getBreaker(route.provider);
      if (breaker.state === "half-open") {
        breaker.halfOpenRequests++;
      }

      const MAX_RETRIES_PER_PROVIDER = 1;

      for (let attempt = 0; attempt <= MAX_RETRIES_PER_PROVIDER; attempt++) {
        try {
          this.logger.info(
            { task, provider: route.provider, model: route.model, attempt },
            "attempting completion",
          );

          const start = Date.now();
          const response = await provider.complete({
            ...request,
            model: route.model,
          });
          const latencyMs = Date.now() - start;

          this.recordSuccess(route.provider, latencyMs);

          // Track cost
          const costMicrodollars = this.estimateCost(
            route.model,
            response.usage.inputTokens,
            response.usage.outputTokens,
          );
          this.totalCostMicrodollars += costMicrodollars;

          this.logger.info(
            {
              task,
              provider: route.provider,
              model: response.model,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              latencyMs,
              costMicrodollars,
            },
            "completion succeeded",
          );

          // Fire onCompletion hook (fire-and-forget, errors caught to protect caller)
          if (this.onCompletion) {
            try {
              const hookResult = this.onCompletion({
                task,
                provider: route.provider,
                model: response.model,
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                costMicrodollars,
                metadata: (request as LlmCompletionRequest).metadata,
              });
              if (hookResult instanceof Promise) {
                hookResult.catch((err: unknown) => {
                  this.logger.warn({ err }, "onCompletion hook error (async)");
                });
              }
            } catch (err) {
              this.logger.warn({ err }, "onCompletion hook error (sync)");
            }
          }

          return { ...response, provider: route.provider, costMicrodollars };
        } catch (err) {
          this.recordError(route.provider, err instanceof Error ? err.message : String(err));

          // Retry once on transient errors before falling back to next provider
          if (this.isTransientError(err) && attempt < MAX_RETRIES_PER_PROVIDER) {
            const delayMs = 2000 + Math.random() * 1000;
            this.logger.warn(
              { task, provider: route.provider, model: route.model, attempt, delayMs: Math.round(delayMs) },
              "transient error, retrying same provider",
            );
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }

          this.logger.warn(
            { task, provider: route.provider, model: route.model, err },
            "provider failed, trying next",
          );
          errors.push({ provider: route.provider, model: route.model, error: err });
          break; // Move to next provider
        }
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
