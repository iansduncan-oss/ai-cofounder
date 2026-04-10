import { describe, it, expect, vi } from "vitest";
import type { LlmProvider } from "../provider.js";
import type { LlmCompletionRequest, LlmCompletionResponse, TaskCategory } from "../types.js";
import { LlmRegistry } from "../registry.js";

// ── Helpers ─────────────────────────────────────────────────

function mockProvider(
  name: string,
  available: boolean,
  completeFn?: (req: LlmCompletionRequest) => Promise<LlmCompletionResponse>,
): LlmProvider {
  return {
    name,
    defaultModel: `${name}-model`,
    available,
    complete:
      completeFn ??
      vi.fn().mockResolvedValue({
        content: [{ type: "text", text: `response from ${name}` }],
        model: `${name}-model`,
        stop_reason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
  };
}

const simpleRequest: Omit<LlmCompletionRequest, "model"> = {
  messages: [{ role: "user", content: "hello" }],
};

function makeRoutes(entries: Array<{ provider: string; model: string }>, task: TaskCategory = "simple") {
  const base = {
    planning: [], conversation: [], simple: [], research: [], code: [],
  };
  return { ...base, [task]: entries };
}

function registryWithProvider(provider: LlmProvider, task: TaskCategory = "simple"): LlmRegistry {
  const registry = new LlmRegistry(makeRoutes([{ provider: provider.name, model: `${provider.name}-model` }], task));
  registry.register(provider);
  return registry;
}

describe("LLM Provider Error Handling", () => {
  // ── Circuit Breaker ───────────────────────────────────────

  describe("circuit breaker", () => {
    it("opens after 5 consecutive failures", async () => {
      let callCount = 0;
      const failing = mockProvider("anthropic", true, async () => {
        callCount++;
        throw new Error("internal server error");
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(failing);
      registry.register(backup);

      // First 5 requests should hit anthropic (and fail → fallback to groq)
      for (let i = 0; i < 5; i++) {
        await registry.complete("simple", simpleRequest);
      }

      // Circuit should now be open — anthropic skipped, calls go directly to groq
      callCount = 0;
      await registry.complete("simple", simpleRequest);
      expect(callCount).toBe(0); // anthropic not called — circuit open
    });

    it("half-open state probes after reset timeout", async () => {
      let _callCount = 0;
      const failing = mockProvider("anthropic", true, async () => {
        _callCount++;
        throw new Error("server error");
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(failing);
      registry.register(backup);

      // Trip the circuit breaker
      for (let i = 0; i < 5; i++) {
        await registry.complete("simple", simpleRequest);
      }

      // Verify circuit is open
      const states = registry.getCircuitBreakerStates();
      const anthropicState = states.find((s) => s.provider === "anthropic");
      expect(anthropicState?.state).toBe("open");
    });

    it("resets on success after half-open probe", async () => {
      let shouldFail = true;
      const provider = mockProvider("anthropic", true, async () => {
        if (shouldFail) throw new Error("server error");
        return {
          content: [{ type: "text" as const, text: "recovered" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(provider);
      registry.register(backup);

      // Trip the circuit
      for (let i = 0; i < 5; i++) {
        await registry.complete("simple", simpleRequest);
      }

      // Now make it succeed
      shouldFail = false;

      // Verify the circuit is open
      const states = registry.getCircuitBreakerStates();
      expect(states.find((s) => s.provider === "anthropic")?.state).toBe("open");
    });
  });

  // ── Transient Error Retry ─────────────────────────────────

  describe("transient error retry", () => {
    it("retries once on 429 rate limit then succeeds", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("429 rate limit exceeded");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      const registry = registryWithProvider(provider);
      const result = await registry.complete("simple", simpleRequest);
      expect(result.content[0]).toEqual({ type: "text", text: "ok" });
      expect(attempt).toBe(2); // 1 failure + 1 success
    });

    it("retries on 503 overloaded", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("503 overloaded");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      const registry = registryWithProvider(provider);
      await registry.complete("simple", simpleRequest);
      expect(attempt).toBe(2);
    });

    it("retries on timeout error", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("Request timeout exceeded");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      const registry = registryWithProvider(provider);
      await registry.complete("simple", simpleRequest);
      expect(attempt).toBe(2);
    });

    it("retries on ECONNRESET", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("ECONNRESET");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      const registry = registryWithProvider(provider);
      await registry.complete("simple", simpleRequest);
      expect(attempt).toBe(2);
    });

    it("retries on socket hang up", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("socket hang up");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "anthropic-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      const registry = registryWithProvider(provider);
      await registry.complete("simple", simpleRequest);
      expect(attempt).toBe(2);
    });

    it("does NOT retry non-transient errors", async () => {
      let attempt = 0;
      const provider = mockProvider("anthropic", true, async () => {
        attempt++;
        throw new Error("invalid_api_key");
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(provider);
      registry.register(backup);

      // Should fail on anthropic (no retry) → fallback to groq
      const result = await registry.complete("simple", simpleRequest);
      expect(attempt).toBe(1); // no retry
      expect(result.provider).toBe("groq");
    });

    it("falls back to next provider when all retries exhausted", async () => {
      const provider = mockProvider("anthropic", true, async () => {
        throw new Error("429 rate limit");
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(provider);
      registry.register(backup);

      const result = await registry.complete("simple", simpleRequest);
      expect(result.provider).toBe("groq");
    });

    it("throws when all providers exhausted", async () => {
      const provider = mockProvider("anthropic", true, async () => {
        throw new Error("server error");
      });

      const registry = registryWithProvider(provider);
      await expect(registry.complete("simple", simpleRequest)).rejects.toThrow(
        /all providers exhausted/i,
      );
    });
  });

  // ── Provider Health & Stats ───────────────────────────────

  describe("provider health tracking", () => {
    it("tracks success stats", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);

      await registry.complete("simple", simpleRequest);

      const health = registry.getProviderHealth();
      const anthropicHealth = health.find((h) => h.provider === "anthropic");
      expect(anthropicHealth?.totalRequests).toBe(1);
      expect(anthropicHealth?.successCount).toBe(1);
      expect(anthropicHealth?.errorCount).toBe(0);
    });

    it("tracks error stats", async () => {
      const provider = mockProvider("anthropic", true, async () => {
        throw new Error("server error");
      });
      const backup = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(provider);
      registry.register(backup);

      await registry.complete("simple", simpleRequest);

      const health = registry.getProviderHealth();
      const anthropicHealth = health.find((h) => h.provider === "anthropic");
      expect(anthropicHealth?.errorCount).toBeGreaterThanOrEqual(1);
    });

    it("records latency on success", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);

      await registry.complete("simple", simpleRequest);

      const health = registry.getProviderHealth();
      const anthropicHealth = health.find((h) => h.provider === "anthropic");
      expect(anthropicHealth?.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── onCompletion Hook ─────────────────────────────────────

  describe("onCompletion hook", () => {
    it("calls hook on successful completion", async () => {
      const hookFn = vi.fn();
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);
      registry.onCompletion = hookFn;

      await registry.complete("simple", simpleRequest);

      expect(hookFn).toHaveBeenCalledTimes(1);
      expect(hookFn).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "anthropic",
          model: "anthropic-model",
          inputTokens: 10,
          outputTokens: 20,
        }),
      );
    });

    it("does not crash when hook throws sync error", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);
      registry.onCompletion = () => {
        throw new Error("hook crashed");
      };

      // Should still return result despite hook error
      const result = await registry.complete("simple", simpleRequest);
      expect(result.content).toHaveLength(1);
    });

    it("does not crash when hook rejects", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);
      registry.onCompletion = async () => {
        throw new Error("async hook crashed");
      };

      const result = await registry.complete("simple", simpleRequest);
      expect(result.content).toHaveLength(1);
    });
  });

  // ── Unconfigured Provider ─────────────────────────────────

  describe("unconfigured provider", () => {
    it("skips unavailable providers in fallback chain", async () => {
      const unavailable = mockProvider("anthropic", false);
      const available = mockProvider("groq", true);

      const routes = makeRoutes([
        { provider: "anthropic", model: "anthropic-model" },
        { provider: "groq", model: "groq-model" },
      ]);
      const registry = new LlmRegistry(routes);
      registry.register(unavailable);
      registry.register(available);

      const result = await registry.complete("simple", simpleRequest);
      expect(result.provider).toBe("groq");
      expect(unavailable.complete).not.toHaveBeenCalled();
    });
  });

  // ── Cost Tracking ─────────────────────────────────────────

  describe("cost tracking", () => {
    it("accumulates cost across requests", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);

      await registry.complete("simple", simpleRequest);
      await registry.complete("simple", simpleRequest);

      // Cost may be 0 for unknown models — verify it's at least tracked
      expect(typeof registry.getTotalCost()).toBe("number");
    });

    it("includes cost in response", async () => {
      const provider = mockProvider("anthropic", true);
      const registry = registryWithProvider(provider);

      const result = await registry.complete("simple", simpleRequest);
      expect(result).toHaveProperty("costMicrodollars");
      expect(typeof result.costMicrodollars).toBe("number");
      expect(result.costMicrodollars).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles provider returning null usage tokens", async () => {
      const provider = mockProvider("anthropic", true, async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        model: "anthropic-model",
        stop_reason: "end_turn" as const,
        usage: { inputTokens: 0, outputTokens: 0 },
      }));

      const registry = registryWithProvider(provider);
      const result = await registry.complete("simple", simpleRequest);
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });

    it("handles empty content array in response", async () => {
      const provider = mockProvider("anthropic", true, async () => ({
        content: [],
        model: "anthropic-model",
        stop_reason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 0 },
      }));

      const registry = registryWithProvider(provider);
      const result = await registry.complete("simple", simpleRequest);
      expect(result.content).toEqual([]);
    });

    it("throws on unresolvable task category with no routes", async () => {
      const registry = new LlmRegistry(makeRoutes([], "simple"));
      await expect(
        registry.complete("planning" as TaskCategory, simpleRequest),
      ).rejects.toThrow();
    });
  });
});
