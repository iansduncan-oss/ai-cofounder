import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

import { LlmRegistry } from "../registry.js";
import type { LlmProvider } from "../provider.js";
import type { TaskCategory } from "../types.js";

function createMockProvider(name: string, available = true): LlmProvider {
  return {
    name,
    available,
    defaultModel: `${name}-model`,
    complete: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      model: `${name}-model`,
      stop_reason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

/**
 * Build custom routes where the "simple" category has two entries:
 *   1. providerA → claude-opus-4-20250901 (expensive: $15/$75 per 1M)
 *   2. providerB → llama-3.1-8b-instant   (cheap: $0.05/$0.08 per 1M)
 * All other categories point to providerA as a placeholder.
 */
function buildRoutes(): Record<TaskCategory, Array<{ provider: string; model: string }>> {
  const filler = [{ provider: "providerA", model: "claude-opus-4-20250901" }];
  return {
    planning: filler,
    conversation: filler,
    research: filler,
    code: filler,
    simple: [
      { provider: "providerA", model: "claude-opus-4-20250901" },
      { provider: "providerB", model: "llama-3.1-8b-instant" },
    ],
  };
}

describe("LlmRegistry — scoring & cost-aware routing", () => {
  let registry: LlmRegistry;
  let providerA: LlmProvider;
  let providerB: LlmProvider;

  beforeEach(() => {
    registry = new LlmRegistry(buildRoutes());
    providerA = createMockProvider("providerA");
    providerB = createMockProvider("providerB");
    registry.register(providerA);
    registry.register(providerB);
  });

  const request = { messages: [{ role: "user" as const, content: "hello" }] };

  it("costWeight=0 preserves original chain order", async () => {
    await registry.complete("simple", request, { costWeight: 0 });

    // providerA is first in the chain and costWeight=0 means pure quality ordering
    expect(providerA.complete).toHaveBeenCalled();
    expect(providerB.complete).not.toHaveBeenCalled();
  });

  it("costWeight=1 sorts cheapest first", async () => {
    await registry.complete("simple", request, { costWeight: 1 });

    // With costWeight=1 the cheap llama model on providerB should be preferred
    expect(providerB.complete).toHaveBeenCalled();
    expect(providerA.complete).not.toHaveBeenCalled();
  });

  it("high error-rate provider ranked below healthy provider", async () => {
    // Seed providerA with a 90% error rate
    registry.seedStats([
      {
        providerName: "providerA",
        requestCount: 100,
        successCount: 10,
        errorCount: 90,
        avgLatencyMs: 200,
      },
    ]);

    // With costWeight=0.5 the error penalty on providerA should drop it below providerB
    const result = await registry.complete("simple", request, { costWeight: 0.5 });

    expect(result.provider).toBe("providerB");
    expect(providerB.complete).toHaveBeenCalled();
  });

  it("circuit-open provider still skipped regardless of score", async () => {
    // Open providerA's circuit by making it fail 5 consecutive times
    const failingA: LlmProvider = {
      name: "providerA",
      available: true,
      defaultModel: "providerA-model",
      complete: vi.fn().mockRejectedValue(new Error("boom")),
    };

    // Re-create registry with the failing provider
    registry = new LlmRegistry(buildRoutes());
    registry.register(failingA);
    registry.register(providerB);

    // Each call fails on providerA then succeeds on providerB — 5 failures trips the breaker
    for (let i = 0; i < 5; i++) {
      await registry.complete("simple", request);
    }

    // Verify circuit is open
    const states = registry.getCircuitBreakerStates();
    const aState = states.find((s) => s.provider === "providerA");
    expect(aState?.state).toBe("open");

    // Now request with costWeight=1 — providerA (opus) is the most expensive so costWeight=1
    // would normally rank providerB first anyway, but even with costWeight=0 the circuit-open
    // check would skip providerA
    (failingA.complete as ReturnType<typeof vi.fn>).mockClear();
    await registry.complete("simple", request, { costWeight: 0 });

    // providerA should not have been called because its circuit is open
    expect(failingA.complete).not.toHaveBeenCalled();
    expect(providerB.complete).toHaveBeenCalled();
  });

  it("maxCostMicrodollars filters expensive models", async () => {
    // Opus estimated cost: (1000/1M)*15*1M + (500/1M)*75*1M = 15000 + 37500 = 52500
    // Llama estimated cost: (1000/1M)*0.05*1M + (500/1M)*0.08*1M = 50 + 40 = 90
    // Set max to 1000 — excludes opus, includes llama
    const result = await registry.complete("simple", request, { maxCostMicrodollars: 1000 });

    expect(result.provider).toBe("providerB");
    expect(providerA.complete).not.toHaveBeenCalled();
  });

  it("estimateRequestCost returns correct microdollars", () => {
    // claude-sonnet-4-20250514: inputPer1M=3, outputPer1M=15
    // expected = (1000/1_000_000)*3*1_000_000 + (500/1_000_000)*15*1_000_000 = 3000 + 7500 = 10500
    const cost = registry.estimateRequestCost("claude-sonnet-4-20250514", 1000, 500);
    expect(cost).toBe(10500);
  });
});
