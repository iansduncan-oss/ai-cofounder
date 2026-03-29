import { describe, it, expect, vi, beforeAll } from "vitest";
import { flushPromises, mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockSaveThinkingTrace = vi.fn().mockResolvedValue({ id: "tt-1", conversationId: "conv-1", round: 0, content: "test" });
const mockGetThinkingTraces = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  saveThinkingTrace: (...args: unknown[]) => mockSaveThinkingTrace(...args),
  getThinkingTraces: (...args: unknown[]) => mockGetThinkingTraces(...args),
}));

vi.mock("@ai-cofounder/llm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      model: "test",
      stop_reason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      provider: "test",
    });
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return { ...actual, LlmRegistry: MockLlmRegistry };
});

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn(),
  enqueueReflection: vi.fn(),
}));

describe("Reasoning Traces", () => {
  describe("Thinking tag parsing", () => {
    it("should extract thinking blocks from response text", async () => {
      const { Orchestrator } = await import("../agents/orchestrator.js");
      const { LlmRegistry } = await import("@ai-cofounder/llm");

      const registry = new LlmRegistry();
      (registry.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: "text", text: "<thinking>Step 1: analyze\nStep 2: decide</thinking>\n\nHere is my response." }],
        model: "test",
        stop_reason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        provider: "test",
      });

      const orchestrator = new Orchestrator({
        registry,
        db: {} as never,
      });

      const result = await orchestrator.run("Test message", "conv-1", [], "user-1", "req-1");

      // Response should have thinking stripped
      expect(result.response).not.toContain("<thinking>");
      expect(result.response).toContain("Here is my response.");
    });

    it("should store thinking traces in the database", async () => {
      const { Orchestrator } = await import("../agents/orchestrator.js");
      const { LlmRegistry } = await import("@ai-cofounder/llm");

      mockSaveThinkingTrace.mockClear();

      const registry = new LlmRegistry();
      (registry.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: "text", text: "<thinking>reasoning here</thinking>\n\nResponse." }],
        model: "test",
        stop_reason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        provider: "test",
      });

      const orchestrator = new Orchestrator({
        registry,
        db: {} as never,
      });

      await orchestrator.run("Test", "conv-1", [], "user-1", "req-1");

      // Wait for fire-and-forget to settle
      await flushPromises();

      expect(mockSaveThinkingTrace).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          conversationId: "conv-1",
          content: "reasoning here",
          round: 0,
        }),
      );
    });

    it("should handle multiple thinking blocks", async () => {
      const { Orchestrator } = await import("../agents/orchestrator.js");
      const { LlmRegistry } = await import("@ai-cofounder/llm");

      mockSaveThinkingTrace.mockClear();

      const registry = new LlmRegistry();
      (registry.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: "text", text: "<thinking>block one</thinking>\nSome text\n<thinking>block two</thinking>\nFinal." }],
        model: "test",
        stop_reason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        provider: "test",
      });

      const orchestrator = new Orchestrator({
        registry,
        db: {} as never,
      });

      const result = await orchestrator.run("Test", "conv-1", [], "user-1");

      await flushPromises();

      expect(result.response).not.toContain("<thinking>");
      expect(result.response).toContain("Some text");
      expect(result.response).toContain("Final.");
      expect(mockSaveThinkingTrace).toHaveBeenCalledTimes(2);
    });

    it("should handle text with no thinking blocks", async () => {
      const { Orchestrator } = await import("../agents/orchestrator.js");
      const { LlmRegistry } = await import("@ai-cofounder/llm");

      mockSaveThinkingTrace.mockClear();

      const registry = new LlmRegistry();
      (registry.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: "text", text: "Just a plain response" }],
        model: "test",
        stop_reason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        provider: "test",
      });

      const orchestrator = new Orchestrator({
        registry,
        db: {} as never,
      });

      const result = await orchestrator.run("Test", "conv-1");

      expect(result.response).toBe("Just a plain response");
      expect(mockSaveThinkingTrace).not.toHaveBeenCalled();
    });
  });

  describe("getThinkingTraces repository", () => {
    it("should call getThinkingTraces with conversationId", async () => {
      mockGetThinkingTraces.mockResolvedValueOnce([
        { id: "tt-1", conversationId: "conv-1", requestId: "req-1", round: 0, content: "thinking about it" },
      ]);

      const { getThinkingTraces } = await import("@ai-cofounder/db");
      const result = await getThinkingTraces({} as never, "conv-1");
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("thinking about it");
    });

    it("should call getThinkingTraces with requestId filter", async () => {
      mockGetThinkingTraces.mockResolvedValueOnce([]);
      const { getThinkingTraces } = await import("@ai-cofounder/db");
      await getThinkingTraces({} as never, "conv-1", "req-1");
      expect(mockGetThinkingTraces).toHaveBeenCalledWith(expect.anything(), "conv-1", "req-1");
    });
  });
});
