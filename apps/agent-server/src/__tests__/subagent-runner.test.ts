import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockUpdateSubagentRunStatus = vi.fn().mockResolvedValue({});
const mockRecallMemories = vi.fn().mockResolvedValue([]);
const mockSearchMemoriesByVector = vi.fn().mockResolvedValue([]);
const mockRecordToolExecution = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  updateSubagentRunStatus: (...args: unknown[]) => mockUpdateSubagentRunStatus(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  searchMemoriesByVector: (...args: unknown[]) => mockSearchMemoriesByVector(...args),
  recordToolExecution: (...args: unknown[]) => mockRecordToolExecution(...args),
}));

vi.mock("@ai-cofounder/queue", () => ({
  subagentChannel: (id: string) => `channel:sub:${id}`,
  subagentHistoryKey: (id: string) => `history:sub:${id}`,
}));

vi.mock("../plugins/observability.js", () => ({
  recordToolMetrics: vi.fn(),
  recordSubagentMetrics: vi.fn(),
}));

vi.mock("../agents/tool-executor.js", () => ({
  buildSharedToolList: vi.fn().mockReturnValue([
    { name: "search_web", description: "Search", input_schema: { type: "object", properties: {}, required: [] } },
  ]),
  executeSharedTool: vi.fn().mockResolvedValue({ results: [] }),
}));

const mockComplete = vi.fn();

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createEmbeddingService: vi.fn(),
  };
});

const { SubagentRunner } = await import("../services/subagent.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");
const { executeSharedTool, buildSharedToolList } = await import("../agents/tool-executor.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SubagentRunner", () => {
  const db = {} as any;

  function createRunner() {
    const registry = new LlmRegistry();
    return new SubagentRunner(registry, db);
  }

  const baseParams = {
    subagentRunId: "run-1",
    title: "Test task",
    instruction: "Do the thing",
  };

  describe("simple text response (no tool use)", () => {
    it("completes successfully with text output", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: "text", text: "Task completed successfully" }],
        model: "claude-sonnet",
        stop_reason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        provider: "anthropic",
      });

      const runner = createRunner();
      const result = await runner.run(baseParams);

      expect(result.output).toBe("Task completed successfully");
      expect(result.model).toBe("claude-sonnet");
      expect(result.provider).toBe("anthropic");
      expect(result.rounds).toBe(0);
      expect(result.toolsUsed).toEqual([]);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("marks run as running then completed in DB", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: "text", text: "Done" }],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 20 },
        provider: "test",
      });

      const runner = createRunner();
      await runner.run(baseParams);

      // First call: mark as running
      expect(mockUpdateSubagentRunStatus).toHaveBeenCalledWith(
        db,
        "run-1",
        expect.objectContaining({ status: "running" }),
      );
      // Last call: mark as completed
      const lastCall = mockUpdateSubagentRunStatus.mock.calls.at(-1);
      expect(lastCall?.[2]).toEqual(
        expect.objectContaining({
          status: "completed",
          output: "Done",
        }),
      );
    });
  });

  describe("tool loop", () => {
    it("executes one tool round then returns text", async () => {
      // First call: tool use
      mockComplete
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "tu-1", name: "search_web", input: { query: "test" } }],
          model: "claude-sonnet",
          stop_reason: "tool_use",
          usage: { inputTokens: 50, outputTokens: 30 },
          provider: "anthropic",
        })
        // Second call: text response after tool result
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Found the answer" }],
          model: "claude-sonnet",
          stop_reason: "end_turn",
          usage: { inputTokens: 80, outputTokens: 40 },
          provider: "anthropic",
        });

      const runner = createRunner();
      const result = await runner.run(baseParams);

      expect(result.output).toBe("Found the answer");
      expect(result.rounds).toBe(1);
      expect(result.toolsUsed).toEqual(["search_web"]);
      expect(result.usage.inputTokens).toBe(130);
      expect(result.usage.outputTokens).toBe(70);
      expect(mockComplete).toHaveBeenCalledTimes(2);
      expect(executeSharedTool).toHaveBeenCalledTimes(1);
    });

    it("tracks multiple unique tools used", async () => {
      mockComplete
        .mockResolvedValueOnce({
          content: [
            { type: "tool_use", id: "tu-1", name: "search_web", input: { query: "a" } },
            { type: "tool_use", id: "tu-2", name: "browse_web", input: { url: "http://x.com" } },
          ],
          model: "test-model",
          stop_reason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 10 },
          provider: "test",
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Done" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
          provider: "test",
        });

      const runner = createRunner();
      const result = await runner.run(baseParams);

      expect(result.toolsUsed).toEqual(expect.arrayContaining(["search_web", "browse_web"]));
      expect(result.toolsUsed).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("marks run as failed on LLM error", async () => {
      mockComplete.mockRejectedValueOnce(new Error("Provider unavailable"));

      const runner = createRunner();
      await expect(runner.run(baseParams)).rejects.toThrow("Provider unavailable");

      const lastCall = mockUpdateSubagentRunStatus.mock.calls.at(-1);
      expect(lastCall?.[2]).toEqual(
        expect.objectContaining({
          status: "failed",
          error: "Provider unavailable",
        }),
      );
    });

    it("handles tool execution errors gracefully", async () => {
      (executeSharedTool as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Tool failed"));

      mockComplete
        .mockResolvedValueOnce({
          content: [{ type: "tool_use", id: "tu-1", name: "search_web", input: { query: "test" } }],
          model: "test-model",
          stop_reason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 10 },
          provider: "test",
        })
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Recovered" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
          provider: "test",
        });

      const runner = createRunner();
      const result = await runner.run(baseParams);

      expect(result.output).toBe("Recovered");
      expect(result.rounds).toBe(1);
    });
  });

  describe("tool exclusion", () => {
    it("calls buildSharedToolList with exclusion set", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: "text", text: "Done" }],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
        provider: "test",
      });

      const runner = createRunner();
      await runner.run(baseParams);

      expect(buildSharedToolList).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Set),
      );

      const excludeSet = (buildSharedToolList as ReturnType<typeof vi.fn>).mock.calls[0][1] as Set<string>;
      expect(excludeSet.has("delegate_to_subagent")).toBe(true);
      expect(excludeSet.has("delegate_parallel")).toBe(true);
      expect(excludeSet.has("check_subagent")).toBe(true);
      expect(excludeSet.has("create_plan")).toBe(true);
      expect(excludeSet.has("create_milestone")).toBe(true);
      expect(excludeSet.has("request_approval")).toBe(true);
    });
  });

  describe("memory loading", () => {
    it("loads user memories when userId is provided", async () => {
      mockRecallMemories.mockResolvedValueOnce([
        { id: "m-1", category: "projects", key: "main", content: "Building a SaaS" },
      ]);

      mockComplete.mockResolvedValueOnce({
        content: [{ type: "text", text: "Done" }],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
        provider: "test",
      });

      const runner = createRunner();
      await runner.run({ ...baseParams, userId: "user-1" });

      expect(mockRecallMemories).toHaveBeenCalledWith(db, "user-1", { limit: 10 });
    });

    it("skips memory loading when no userId", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [{ type: "text", text: "Done" }],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
        provider: "test",
      });

      const runner = createRunner();
      await runner.run(baseParams);

      expect(mockRecallMemories).not.toHaveBeenCalled();
    });
  });
});
