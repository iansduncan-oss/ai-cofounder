import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// --- DB mocks ---
const mockGetGoal = vi.fn();
const mockListTasksByGoal = vi.fn();
const mockAssignTask = vi.fn().mockResolvedValue({});
const mockStartTask = vi.fn().mockResolvedValue({});
const mockCompleteTask = vi.fn().mockResolvedValue({});
const mockFailTask = vi.fn().mockResolvedValue({});
const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});
const mockListPendingApprovalsForTasks = vi.fn().mockResolvedValue([]);
const mockGetAgentPerformanceStats = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  listTasksByGoal: (...args: unknown[]) => mockListTasksByGoal(...args),
  assignTask: (...args: unknown[]) => mockAssignTask(...args),
  startTask: (...args: unknown[]) => mockStartTask(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  failTask: (...args: unknown[]) => mockFailTask(...args),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  listPendingApprovalsForTasks: (...args: unknown[]) => mockListPendingApprovalsForTasks(...args),
  getAgentPerformanceStats: (...args: unknown[]) => mockGetAgentPerformanceStats(...args),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue({}),
  recordLlmUsage: vi.fn().mockResolvedValue({}),
  saveCodeExecution: vi.fn().mockResolvedValue({}),
  createJournalEntry: vi.fn().mockResolvedValue({}),
}));

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Agent output" }],
  model: "test-model",
  stop_reason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 20 },
  provider: "test",
});

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
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: { name: "search_web", description: "search", input_schema: { type: "object", properties: {} } },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  RECALL_MEMORIES_TOOL: { name: "recall_memories", description: "recall", input_schema: { type: "object", properties: {} } },
}));

vi.mock("../agents/tools/sandbox-tools.js", () => ({
  EXECUTE_CODE_TOOL: {
    name: "execute_code",
    description: "execute",
    input_schema: { type: "object", properties: { code: { type: "string" }, language: { type: "string" } }, required: ["code", "language"] },
  },
}));

vi.mock("../services/notifications.js", () => ({
  NotificationService: class {
    notifyGoalCompleted = vi.fn().mockResolvedValue(undefined);
    notifyTaskFailed = vi.fn().mockResolvedValue(undefined);
    notifyGoalProgress = vi.fn().mockResolvedValue(undefined);
    notifyApprovalCreated = vi.fn().mockResolvedValue(undefined);
    isConfigured = vi.fn().mockReturnValue(true);
  },
}));

const { TaskDispatcher } = await import("../agents/dispatcher.js");
const { AdaptiveRoutingService } = await import("../services/adaptive-routing.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Adaptive routing wiring", { timeout: 15_000 }, () => {
  describe("dispatcher uses AdaptiveRoutingService when provided", () => {
    it("calls suggestAgent and recordDecision during task execution", async () => {
      const fakeDb = {} as any;
      const service = new AdaptiveRoutingService(fakeDb);
      const suggestSpy = vi.spyOn(service, "suggestAgent").mockResolvedValue({
        recommended: "researcher",
        confidence: 0.3,
        reasoning: "Keep current assignment",
        stats: [],
      });
      const recordSpy = vi.spyOn(service, "recordDecision");

      const registry = new LlmRegistry();
      const dispatcher = new TaskDispatcher(
        registry,
        fakeDb,
        undefined, // embeddingService
        undefined, // sandboxService
        undefined, // notificationService
        undefined, // workspaceService
        undefined, // verificationService
        undefined, // planRepairService
        undefined, // proceduralMemoryService
        service,   // adaptiveRoutingService
      );

      mockGetGoal.mockResolvedValueOnce({ id: "g1", title: "Test Goal", status: "pending" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t1", title: "Task 1", assignedAgent: "researcher", orderIndex: 0, status: "pending" },
      ]);

      await dispatcher.runGoal("g1", "user1");

      expect(suggestSpy).toHaveBeenCalledWith("Task 1", "researcher");
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "t1",
          originalAgent: "researcher",
          recommendedAgent: "researcher",
          confidence: 0.3,
          overridden: false,
        }),
      );
    });

    it("overrides agent when confidence >= 0.7", async () => {
      const fakeDb = {} as any;
      const service = new AdaptiveRoutingService(fakeDb);
      vi.spyOn(service, "suggestAgent").mockResolvedValue({
        recommended: "coder",
        confidence: 0.8,
        reasoning: "Coder outperforms researcher",
        stats: [],
      });
      const recordSpy = vi.spyOn(service, "recordDecision");

      const registry = new LlmRegistry();
      const dispatcher = new TaskDispatcher(
        registry,
        fakeDb,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        service,
      );

      mockGetGoal.mockResolvedValueOnce({ id: "g2", title: "Test Goal 2", status: "pending" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t2", title: "Task 2", assignedAgent: "researcher", orderIndex: 0, status: "pending" },
      ]);

      await dispatcher.runGoal("g2", "user1");

      // Should have been overridden to coder
      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "t2",
          originalAgent: "researcher",
          recommendedAgent: "coder",
          overridden: true,
        }),
      );

      // Task should have been assigned to the overridden agent
      expect(mockAssignTask).toHaveBeenCalledWith(fakeDb, "t2", "coder");
    });

    it("does not override when confidence < 0.7", async () => {
      const fakeDb = {} as any;
      const service = new AdaptiveRoutingService(fakeDb);
      vi.spyOn(service, "suggestAgent").mockResolvedValue({
        recommended: "coder",
        confidence: 0.5,
        reasoning: "Coder slightly better",
        stats: [],
      });

      const registry = new LlmRegistry();
      const dispatcher = new TaskDispatcher(
        registry,
        fakeDb,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        service,
      );

      mockGetGoal.mockResolvedValueOnce({ id: "g3", title: "Test Goal 3", status: "pending" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t3", title: "Task 3", assignedAgent: "researcher", orderIndex: 0, status: "pending" },
      ]);

      await dispatcher.runGoal("g3", "user1");

      // Should keep original assignment
      expect(mockAssignTask).toHaveBeenCalledWith(fakeDb, "t3", "researcher");
    });
  });

  describe("dispatcher works without AdaptiveRoutingService", () => {
    it("executes tasks normally when service is not provided", async () => {
      const fakeDb = {} as any;
      const registry = new LlmRegistry();
      const dispatcher = new TaskDispatcher(
        registry,
        fakeDb,
        // No optional services
      );

      mockGetGoal.mockResolvedValueOnce({ id: "g4", title: "Test Goal 4", status: "pending" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t4", title: "Task 4", assignedAgent: "researcher", orderIndex: 0, status: "pending" },
      ]);

      const result = await dispatcher.runGoal("g4", "user1");

      expect(result.status).toBe("completed");
      expect(mockAssignTask).toHaveBeenCalledWith(fakeDb, "t4", "researcher");
    });
  });

  describe("AdaptiveRoutingService graceful failure", () => {
    it("falls back to original agent when suggestAgent throws", async () => {
      const fakeDb = {} as any;
      const service = new AdaptiveRoutingService(fakeDb);
      vi.spyOn(service, "suggestAgent").mockRejectedValue(new Error("DB down"));

      const registry = new LlmRegistry();
      const dispatcher = new TaskDispatcher(
        registry,
        fakeDb,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        service,
      );

      mockGetGoal.mockResolvedValueOnce({ id: "g5", title: "Test Goal 5", status: "pending" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t5", title: "Task 5", assignedAgent: "coder", orderIndex: 0, status: "pending" },
      ]);

      const result = await dispatcher.runGoal("g5", "user1");

      // Should still complete with original agent despite routing failure
      expect(result.status).toBe("completed");
      expect(mockAssignTask).toHaveBeenCalledWith(fakeDb, "t5", "coder");
    });
  });
});
