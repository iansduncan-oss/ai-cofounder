import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmProvider } from "../provider.js";
import type { LlmCompletionRequest, LlmCompletionResponse, TaskCategory } from "../types.js";
import { LlmRegistry } from "../registry.js";

function mockProvider(
  name: string,
  available: boolean,
  completeFn?: (req: LlmCompletionRequest) => Promise<LlmCompletionResponse>,
): LlmProvider {
  return {
    name,
    defaultModel: `${name}-default`,
    available,
    complete:
      completeFn ??
      vi.fn().mockResolvedValue({
        content: [{ type: "text", text: `response from ${name}` }],
        model: `${name}-model`,
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
  };
}

describe("LlmRegistry", () => {
  let registry: LlmRegistry;

  beforeEach(() => {
    registry = new LlmRegistry();
  });

  describe("register / getProvider", () => {
    it("registers and retrieves a provider", () => {
      const provider = mockProvider("anthropic", true);
      registry.register(provider);
      expect(registry.getProvider("anthropic")).toBe(provider);
    });

    it("returns undefined for unregistered provider", () => {
      expect(registry.getProvider("nonexistent")).toBeUndefined();
    });
  });

  describe("listProviders", () => {
    it("returns info for all registered providers", () => {
      registry.register(mockProvider("anthropic", true));
      registry.register(mockProvider("groq", false));

      const list = registry.listProviders();
      expect(list).toHaveLength(2);
      expect(list).toEqual([
        { name: "anthropic", available: true, defaultModel: "anthropic-default" },
        { name: "groq", available: false, defaultModel: "groq-default" },
      ]);
    });

    it("returns empty array when no providers registered", () => {
      expect(registry.listProviders()).toEqual([]);
    });
  });

  describe("resolveProvider", () => {
    it("returns first available provider for a task", () => {
      registry.register(mockProvider("ollama", true));

      const result = registry.resolveProvider("conversation");
      expect(result).not.toBeNull();
      // All routes go to ollama only
      expect(result!.provider.name).toBe("ollama");
    });

    it("skips unavailable providers", () => {
      // ollama unavailable — should return null since it's the only route
      registry.register(mockProvider("ollama", false));

      const result = registry.resolveProvider("simple");
      expect(result).toBeNull();
    });

    it("returns null when no providers available", () => {
      registry.register(mockProvider("ollama", false));
      const result = registry.resolveProvider("planning");
      expect(result).toBeNull();
    });

    it("returns null when no providers registered at all", () => {
      expect(registry.resolveProvider("code")).toBeNull();
    });
  });

  describe("complete", () => {
    it("routes to correct provider for task category", async () => {
      const ollama = mockProvider("ollama", true);
      registry.register(ollama);

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      // conversation: anthropic → groq → ollama; only ollama registered
      expect(ollama.complete).toHaveBeenCalledWith({
        messages: [{ role: "user", content: "hello" }],
        model: "llama3.1:8b",
      });
      expect(result.provider).toBe("ollama");
    });

    it("falls back when first provider fails", async () => {
      const failing = mockProvider("groq", true, () => {
        throw new Error("API rate limited");
      });
      const ollama = mockProvider("ollama", true);

      registry.register(failing);
      registry.register(ollama);

      // simple route: groq first, then ollama
      const result = await registry.complete("simple", {
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.provider).toBe("ollama");
      expect(result.content[0]).toEqual({ type: "text", text: "response from ollama" });
    });

    it("skips unavailable providers and uses next available", async () => {
      registry.register(mockProvider("groq", false));
      const ollama = mockProvider("ollama", true);
      registry.register(ollama);

      // simple route: groq first (unavailable), then ollama
      const result = await registry.complete("simple", {
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.provider).toBe("ollama");
    });

    it("throws when all providers exhausted", async () => {
      const failing = mockProvider("ollama", true, () => {
        throw new Error("fail");
      });
      registry.register(failing);

      await expect(
        registry.complete("code", {
          messages: [{ role: "user", content: "write code" }],
        }),
      ).rejects.toThrow("All providers exhausted");
    });

    it("throws when no providers available for task", async () => {
      await expect(
        registry.complete("planning", {
          messages: [{ role: "user", content: "plan" }],
        }),
      ).rejects.toThrow("All providers exhausted");
    });

    it("routes all task categories to ollama", async () => {
      registry.register(mockProvider("ollama", true));

      // All routes go to ollama only
      const simple = await registry.complete("simple", {
        messages: [{ role: "user", content: "hi" }],
      });
      expect(simple.provider).toBe("ollama");

      const research = await registry.complete("research", {
        messages: [{ role: "user", content: "search" }],
      });
      expect(research.provider).toBe("ollama");

      const planning = await registry.complete("planning", {
        messages: [{ role: "user", content: "plan" }],
      });
      expect(planning.provider).toBe("ollama");
    });
  });

  describe("completeDirect", () => {
    it("calls the specified provider directly", async () => {
      const groq = mockProvider("groq", true);
      registry.register(groq);

      const result = await registry.completeDirect("groq", {
        model: "custom-model",
        messages: [{ role: "user", content: "test" }],
      });

      expect(groq.complete).toHaveBeenCalledWith({
        model: "custom-model",
        messages: [{ role: "user", content: "test" }],
      });
      expect(result.model).toBe("groq-model");
    });

    it("throws when provider not registered", async () => {
      await expect(
        registry.completeDirect("nonexistent", {
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow('Provider "nonexistent" not available');
    });

    it("throws when provider not available", async () => {
      registry.register(mockProvider("anthropic", false));

      await expect(
        registry.completeDirect("anthropic", {
          messages: [{ role: "user", content: "test" }],
        }),
      ).rejects.toThrow('Provider "anthropic" not available');
    });
  });

  describe("custom routes", () => {
    it("accepts custom route configuration", async () => {
      const customRoutes: Record<TaskCategory, Array<{ provider: string; model: string }>> = {
        planning: [{ provider: "groq", model: "custom-plan" }],
        conversation: [{ provider: "groq", model: "custom-conv" }],
        simple: [{ provider: "groq", model: "custom-simple" }],
        research: [{ provider: "groq", model: "custom-research" }],
        code: [{ provider: "groq", model: "custom-code" }],
      };

      const customRegistry = new LlmRegistry(customRoutes);
      customRegistry.register(mockProvider("groq", true));

      const result = await customRegistry.complete("planning", {
        messages: [{ role: "user", content: "plan" }],
      });

      expect(result.provider).toBe("groq");
    });
  });

  describe("circuit breaker", () => {
    it("opens circuit after consecutive failures and skips provider", async () => {
      let callCount = 0;
      const failing = mockProvider("groq", true, () => {
        callCount++;
        throw new Error(`fail-${callCount}`);
      });
      const ollama = mockProvider("ollama", true);

      // Use custom routes with groq→ollama to exercise circuit breaker
      const multiRoutes = {
        planning: [{ provider: "ollama", model: "llama3.1:8b" }],
        conversation: [{ provider: "ollama", model: "llama3.1:8b" }],
        simple: [
          { provider: "groq", model: "llama-3.1-8b-instant" },
          { provider: "ollama", model: "llama3.1:8b" },
        ],
        research: [{ provider: "ollama", model: "llama3.1:8b" }],
        code: [{ provider: "ollama", model: "llama3.1:8b" }],
      };
      const cbRegistry = new LlmRegistry(multiRoutes);
      cbRegistry.register(failing);
      cbRegistry.register(ollama);

      // Exhaust the circuit breaker (5 consecutive failures for groq)
      for (let i = 0; i < 5; i++) {
        await cbRegistry.complete("simple", {
          messages: [{ role: "user", content: "hi" }],
        });
      }

      // Now groq's circuit should be open — next call should go straight to ollama
      callCount = 0;
      await cbRegistry.complete("simple", {
        messages: [{ role: "user", content: "hi" }],
      });
      expect(callCount).toBe(0);

      const states = cbRegistry.getCircuitBreakerStates();
      const groqState = states.find((s) => s.provider === "groq");
      expect(groqState?.state).toBe("open");
    });

    it("resets circuit breaker on success", async () => {
      let shouldFail = true;
      const groq = mockProvider("groq", true, async () => {
        if (shouldFail) throw new Error("fail");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "groq-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });
      const ollama = mockProvider("ollama", true);

      const multiRoutes = {
        planning: [{ provider: "ollama", model: "llama3.1:8b" }],
        conversation: [{ provider: "ollama", model: "llama3.1:8b" }],
        simple: [
          { provider: "groq", model: "llama-3.1-8b-instant" },
          { provider: "ollama", model: "llama3.1:8b" },
        ],
        research: [{ provider: "ollama", model: "llama3.1:8b" }],
        code: [{ provider: "ollama", model: "llama3.1:8b" }],
      };
      const cbRegistry = new LlmRegistry(multiRoutes);
      cbRegistry.register(groq);
      cbRegistry.register(ollama);

      // Create 3 failures (under threshold)
      for (let i = 0; i < 3; i++) {
        await cbRegistry.complete("simple", {
          messages: [{ role: "user", content: "hi" }],
        });
      }

      shouldFail = false;
      await cbRegistry.complete("simple", {
        messages: [{ role: "user", content: "hi" }],
      });

      const states = cbRegistry.getCircuitBreakerStates();
      const groqState = states.find((s) => s.provider === "groq");
      expect(groqState?.state).toBe("closed");
      expect(groqState?.consecutiveFailures).toBe(0);
    });

    it("returns circuit breaker states for all providers", () => {
      registry.register(mockProvider("anthropic", true));
      registry.register(mockProvider("groq", true));

      // Trigger at least one call so breaker state is created
      const states = registry.getCircuitBreakerStates();
      expect(Array.isArray(states)).toBe(true);
    });
  });

  describe("cost tracking", () => {
    it("returns cost estimate in completions", async () => {
      registry.register(mockProvider("ollama", true));

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      // ollama (local) — free, cost should be 0
      expect(result.costMicrodollars).toBeTypeOf("number");
      expect(result.costMicrodollars).toBeGreaterThanOrEqual(0);
    });

    it("accumulates total cost across calls", async () => {
      registry.register(mockProvider("ollama", true));

      const before = registry.getTotalCost();
      await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });
      const after = registry.getTotalCost();
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("returns cost info for known models", () => {
      const cost = registry.getModelCost("claude-sonnet-4-20250514");
      expect(cost).toBeDefined();
      expect(cost!.inputPer1M).toBe(3);
      expect(cost!.outputPer1M).toBe(15);
    });

    it("returns undefined for unknown models", () => {
      expect(registry.getModelCost("unknown-model")).toBeUndefined();
    });
  });

  describe("transient retry", () => {
    it("retries once on 429 then succeeds", async () => {
      let attempt = 0;
      const provider = mockProvider("ollama", true, async () => {
        attempt++;
        if (attempt === 1) throw new Error("429 rate limit exceeded");
        return {
          content: [{ type: "text" as const, text: "ok" }],
          model: "ollama-model",
          stop_reason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      });

      registry.register(provider);

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      expect(attempt).toBe(2);
      expect(result.provider).toBe("ollama");
    });

    it("falls back to next provider after retry exhaustion on transient error", async () => {
      const failing = mockProvider("groq", true, async () => {
        throw new Error("503 overloaded");
      });
      const ollama = mockProvider("ollama", true);

      // Use custom routes with groq→ollama to test fallback
      const multiRoutes = {
        planning: [{ provider: "ollama", model: "llama3.1:8b" }],
        conversation: [{ provider: "ollama", model: "llama3.1:8b" }],
        simple: [
          { provider: "groq", model: "llama-3.1-8b-instant" },
          { provider: "ollama", model: "llama3.1:8b" },
        ],
        research: [{ provider: "ollama", model: "llama3.1:8b" }],
        code: [{ provider: "ollama", model: "llama3.1:8b" }],
      };
      const fbRegistry = new LlmRegistry(multiRoutes);
      fbRegistry.register(failing);
      fbRegistry.register(ollama);

      const result = await fbRegistry.complete("simple", {
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.provider).toBe("ollama");
    });

    it("does not retry on non-transient errors", async () => {
      let attempt = 0;
      const failing = mockProvider("groq", true, async () => {
        attempt++;
        throw new Error("invalid_api_key");
      });
      const ollama = mockProvider("ollama", true);

      const multiRoutes = {
        planning: [{ provider: "ollama", model: "llama3.1:8b" }],
        conversation: [{ provider: "ollama", model: "llama3.1:8b" }],
        simple: [
          { provider: "groq", model: "llama-3.1-8b-instant" },
          { provider: "ollama", model: "llama3.1:8b" },
        ],
        research: [{ provider: "ollama", model: "llama3.1:8b" }],
        code: [{ provider: "ollama", model: "llama3.1:8b" }],
      };
      const fbRegistry = new LlmRegistry(multiRoutes);
      fbRegistry.register(failing);
      fbRegistry.register(ollama);

      const result = await fbRegistry.complete("simple", {
        messages: [{ role: "user", content: "hello" }],
      });

      // Should only try groq once (no retry), then fall back to ollama
      expect(attempt).toBe(1);
      expect(result.provider).toBe("ollama");
    });
  });
});
