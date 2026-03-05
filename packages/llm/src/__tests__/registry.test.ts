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
      registry.register(mockProvider("anthropic", true));
      registry.register(mockProvider("groq", true));

      const result = registry.resolveProvider("conversation");
      expect(result).not.toBeNull();
      expect(result!.provider.name).toBe("anthropic");
      expect(result!.model).toBe("claude-sonnet-4-20250514");
    });

    it("skips unavailable providers", () => {
      registry.register(mockProvider("anthropic", false));
      registry.register(mockProvider("groq", true));

      const result = registry.resolveProvider("conversation");
      expect(result).not.toBeNull();
      expect(result!.provider.name).toBe("groq");
    });

    it("returns null when no providers available", () => {
      registry.register(mockProvider("anthropic", false));
      const result = registry.resolveProvider("planning");
      expect(result).toBeNull();
    });

    it("returns null when no providers registered at all", () => {
      expect(registry.resolveProvider("code")).toBeNull();
    });
  });

  describe("complete", () => {
    it("routes to correct provider for task category", async () => {
      const anthropic = mockProvider("anthropic", true);
      registry.register(anthropic);

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      expect(anthropic.complete).toHaveBeenCalledWith({
        messages: [{ role: "user", content: "hello" }],
        model: "claude-sonnet-4-20250514",
      });
      expect(result.provider).toBe("anthropic");
    });

    it("falls back when first provider fails", async () => {
      const failing = mockProvider("anthropic", true, () => {
        throw new Error("API rate limited");
      });
      const groq = mockProvider("groq", true);

      registry.register(failing);
      registry.register(groq);

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.provider).toBe("groq");
      expect(result.content[0]).toEqual({ type: "text", text: "response from groq" });
    });

    it("skips unavailable providers and uses next available", async () => {
      registry.register(mockProvider("anthropic", false));
      const groq = mockProvider("groq", true);
      registry.register(groq);

      const result = await registry.complete("conversation", {
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.provider).toBe("groq");
    });

    it("throws when all providers exhausted", async () => {
      const failing = mockProvider("anthropic", true, () => {
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

    it("routes different task categories to different providers", async () => {
      registry.register(mockProvider("anthropic", true));
      registry.register(mockProvider("groq", true));
      registry.register(mockProvider("gemini", true));

      const simple = await registry.complete("simple", {
        messages: [{ role: "user", content: "hi" }],
      });
      expect(simple.provider).toBe("groq");

      const research = await registry.complete("research", {
        messages: [{ role: "user", content: "search" }],
      });
      expect(research.provider).toBe("gemini");

      const planning = await registry.complete("planning", {
        messages: [{ role: "user", content: "plan" }],
      });
      expect(planning.provider).toBe("anthropic");
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
});
