/**
 * Tests for LlmRegistry onCompletion hook.
 * Tests the hook fires correctly, is silenced on error, and metadata passes through.
 * Uses LlmRegistry directly (no mocking needed — it's a pure class).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LlmRegistry } from "@ai-cofounder/llm";
import type { LlmProvider, LlmCompletionRequest, LlmCompletionResponse } from "@ai-cofounder/llm";

/** Create a mock LLM provider that returns a canned response */
function makeMockProvider(name: string): LlmProvider & { complete: ReturnType<typeof vi.fn> } {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Hello" }],
    model: "mock-model-1",
    stop_reason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 50 },
  } satisfies LlmCompletionResponse);

  return {
    name,
    defaultModel: "mock-model-1",
    available: true,
    complete: mockComplete,
  };
}

/** Create a registry with a single mock provider that always succeeds */
function makeRegistry(): { registry: LlmRegistry; provider: ReturnType<typeof makeMockProvider> } {
  const registry = new LlmRegistry({
    planning: [{ provider: "mock", model: "mock-model-1" }],
    conversation: [{ provider: "mock", model: "mock-model-1" }],
    simple: [{ provider: "mock", model: "mock-model-1" }],
    research: [{ provider: "mock", model: "mock-model-1" }],
    code: [{ provider: "mock", model: "mock-model-1" }],
  });
  const provider = makeMockProvider("mock");
  registry.register(provider);
  return { registry, provider };
}

describe("LlmRegistry onCompletion hook", () => {
  let registry: LlmRegistry;

  beforeEach(() => {
    ({ registry } = makeRegistry());
  });

  it("fires with correct event data after successful complete()", async () => {
    const onCompletion = vi.fn();
    registry.onCompletion = onCompletion;

    const result = await registry.complete("conversation", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.model).toBe("mock-model-1");
    expect(onCompletion).toHaveBeenCalledOnce();
    const event = onCompletion.mock.calls[0][0];
    expect(event.task).toBe("conversation");
    expect(event.provider).toBe("mock");
    expect(event.model).toBe("mock-model-1");
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    expect(typeof event.costMicrodollars).toBe("number");
  });

  it("does NOT fire when complete() throws (all providers exhausted)", async () => {
    const onCompletion = vi.fn();
    registry.onCompletion = onCompletion;

    // Override the registry to have a failing provider
    const failRegistry = new LlmRegistry({
      conversation: [{ provider: "fail-provider", model: "fail-model" }],
      planning: [],
      simple: [],
      research: [],
      code: [],
    });
    const failProvider: LlmProvider = {
      name: "fail-provider",
      defaultModel: "fail-model",
      available: true,
      complete: vi.fn().mockRejectedValue(new Error("Provider error")),
    };
    failRegistry.register(failProvider);
    failRegistry.onCompletion = onCompletion;

    await expect(
      failRegistry.complete("conversation", { messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("All providers exhausted");

    expect(onCompletion).not.toHaveBeenCalled();
  });

  it("swallows sync throw from onCompletion — complete() still returns normally", async () => {
    registry.onCompletion = () => {
      throw new Error("sync hook error");
    };

    // Should NOT throw
    const result = await registry.complete("conversation", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.model).toBe("mock-model-1");
  });

  it("swallows async rejection from onCompletion — complete() still returns normally", async () => {
    registry.onCompletion = async () => {
      await Promise.reject(new Error("async hook error"));
    };

    // Should NOT throw
    const result = await registry.complete("conversation", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.model).toBe("mock-model-1");
  });

  it("passes metadata from request through to the onCompletion callback", async () => {
    const onCompletion = vi.fn();
    registry.onCompletion = onCompletion;

    await registry.complete("conversation", {
      messages: [{ role: "user", content: "hi" }],
      metadata: { agentRole: "orchestrator", goalId: "g-1", conversationId: "conv-99" },
    });

    expect(onCompletion).toHaveBeenCalledOnce();
    const event = onCompletion.mock.calls[0][0];
    expect(event.metadata).toEqual({
      agentRole: "orchestrator",
      goalId: "g-1",
      conversationId: "conv-99",
    });
  });

  it("works normally when no onCompletion is set (no error)", async () => {
    // No onCompletion assigned
    expect(registry.onCompletion).toBeUndefined();

    const result = await registry.complete("conversation", {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.model).toBe("mock-model-1");
  });
});
