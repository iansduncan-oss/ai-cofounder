import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmProvider } from "../provider.js";
import { LlmRegistry } from "../registry.js";

function mockProvider(name: string, available: boolean): LlmProvider {
  return {
    name,
    defaultModel: `${name}-default`,
    available,
    complete: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: `response from ${name}` }],
      model: `${name}-model`,
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    }),
  };
}

describe("LlmRegistry persistence methods", () => {
  let registry: LlmRegistry;

  beforeEach(() => {
    registry = new LlmRegistry();
  });

  describe("getStatsSnapshots", () => {
    it("returns empty array when no stats recorded", () => {
      expect(registry.getStatsSnapshots()).toEqual([]);
    });

    it("returns snapshots after successful completions", async () => {
      registry.register(mockProvider("ollama", true));

      await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      const snapshots = registry.getStatsSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].providerName).toBe("ollama");
      expect(snapshots[0].requestCount).toBe(1);
      expect(snapshots[0].successCount).toBe(1);
      expect(snapshots[0].errorCount).toBe(0);
      expect(snapshots[0].avgLatencyMs).toBeGreaterThanOrEqual(0);
      expect(snapshots[0].lastSuccessAt).toBeInstanceOf(Date);
      expect(snapshots[0].lastErrorAt).toBeUndefined();
    });

    it("records errors in snapshots", async () => {
      // groq is first in the simple route, so use it as the failing provider
      const failing: LlmProvider = {
        name: "groq",
        defaultModel: "groq-default",
        available: true,
        complete: vi.fn().mockRejectedValue(new Error("API error")),
      };
      registry.register(failing);
      registry.register(mockProvider("ollama", true));

      // simple route: groq -> ollama
      await registry.complete("simple", {
        messages: [{ role: "user", content: "hello" }],
      });

      const snapshots = registry.getStatsSnapshots();
      const groqSnap = snapshots.find((s) => s.providerName === "groq");
      expect(groqSnap).toBeDefined();
      expect(groqSnap!.errorCount).toBe(1);
      expect(groqSnap!.lastErrorMessage).toBe("API error");
      expect(groqSnap!.lastErrorAt).toBeInstanceOf(Date);
    });
  });

  describe("seedStats", () => {
    it("seeds stats from snapshots on empty registry", () => {
      registry.register(mockProvider("anthropic", true));

      registry.seedStats([
        {
          providerName: "anthropic",
          requestCount: 100,
          successCount: 95,
          errorCount: 5,
          avgLatencyMs: 500,
          lastSuccessAt: new Date("2025-01-01"),
        },
      ]);

      const health = registry.getProviderHealth();
      const anthropic = health.find((p) => p.provider === "anthropic");
      expect(anthropic).toBeDefined();
      expect(anthropic!.totalRequests).toBe(100);
      expect(anthropic!.successCount).toBe(95);
      expect(anthropic!.errorCount).toBe(5);
      expect(anthropic!.avgLatencyMs).toBe(500);
    });

    it("does not overwrite existing in-memory stats", async () => {
      registry.register(mockProvider("ollama", true));

      // Make a completion first
      await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      // Then try to seed
      registry.seedStats([
        {
          providerName: "ollama",
          requestCount: 100,
          successCount: 95,
          errorCount: 5,
          avgLatencyMs: 500,
        },
      ]);

      // Should keep the in-memory stats (1 request), not the seeded ones
      const health = registry.getProviderHealth();
      const ollamaHealth = health.find((p) => p.provider === "ollama");
      expect(ollamaHealth!.totalRequests).toBe(1);
    });

    it("seeds stats for providers not yet in memory", () => {
      registry.register(mockProvider("groq", true));

      registry.seedStats([
        {
          providerName: "groq",
          requestCount: 50,
          successCount: 48,
          errorCount: 2,
          avgLatencyMs: 200,
        },
      ]);

      const health = registry.getProviderHealth();
      const groq = health.find((p) => p.provider === "groq");
      expect(groq!.totalRequests).toBe(50);
    });
  });
});
