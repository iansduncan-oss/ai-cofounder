import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { flushPromises, mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// --- Controllable DB mocks ---
const mockGetGoal = vi.fn();
const mockListTasksByGoal = vi.fn();
const mockAssignTask = vi.fn().mockResolvedValue({});
const mockStartTask = vi.fn().mockResolvedValue({});
const mockCompleteTask = vi.fn().mockResolvedValue({});
const mockFailTask = vi.fn().mockResolvedValue({});
const mockBlockTask = vi.fn().mockResolvedValue({});
const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});
const mockListPendingApprovalsForTasks = vi.fn().mockResolvedValue([]);
const mockCreateJournalEntry = vi.fn().mockResolvedValue({ id: "je-1" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getGoal: mockGetGoal,
  listTasksByGoal: mockListTasksByGoal,
  assignTask: mockAssignTask,
  startTask: mockStartTask,
  completeTask: mockCompleteTask,
  failTask: mockFailTask,
  blockTask: mockBlockTask,
  updateGoalStatus: mockUpdateGoalStatus,
  listPendingApprovalsForTasks: mockListPendingApprovalsForTasks,
  createJournalEntry: mockCreateJournalEntry,
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  saveMemory: vi.fn().mockResolvedValue({}),
  recordLlmUsage: vi.fn().mockResolvedValue({}),
  saveCodeExecution: vi.fn().mockResolvedValue({}),
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
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {},
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
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Helpers ---

function createDispatcher() {
  const registry = new LlmRegistry();
  const db = {} as any;
  return new TaskDispatcher(registry, db);
}

function makeTask(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: "Do something",
    status: "pending",
    assignedAgent: "researcher",
    orderIndex: 0,
    parallelGroup: null,
    dependsOn: null,
    goalId: "g-1",
    ...overrides,
  };
}

describe("TaskDispatcher edge cases", { timeout: 15_000 }, () => {
  describe("all multiple tasks fail → goal cancelled", () => {
    it("marks goal cancelled when all 3 tasks fail", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Doomed Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0 }),
        makeTask("t-2", { orderIndex: 1 }),
        makeTask("t-3", { orderIndex: 2 }),
      ]);

      // All tasks fail
      mockComplete
        .mockRejectedValueOnce(new Error("fail-1"))
        .mockRejectedValueOnce(new Error("fail-2"))
        .mockRejectedValueOnce(new Error("fail-3"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("failed");
      expect(result.completedTasks).toBe(0);
      expect(result.totalTasks).toBe(3);
      expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), "g-1", "cancelled");

      // Verify journal entry for goal failure was created
      await flushPromises();
      expect(mockCreateJournalEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entryType: "goal_failed",
          title: "Goal failed: Doomed Goal",
        }),
      );
    });
  });

  describe("some tasks pass, some fail → goal stays in_progress", () => {
    it("does not mark goal cancelled or completed when results are mixed", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Mixed Results" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0 }),
        makeTask("t-2", { orderIndex: 1 }),
      ]);

      // First task succeeds, second task fails
      mockComplete
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Success output" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        })
        .mockRejectedValueOnce(new Error("task-2 failed"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("in_progress");
      expect(result.completedTasks).toBe(1);
      expect(result.totalTasks).toBe(2);

      // Goal should NOT have been marked as "cancelled" or "completed"
      const statusCalls = mockUpdateGoalStatus.mock.calls.map((c) => c[2]);
      expect(statusCalls).not.toContain("cancelled");
      expect(statusCalls).not.toContain("completed");
    });
  });

  describe("dependency chain — downstream blocked on failure (DAG)", () => {
    it("blocks t-2 and t-3 when t-1 fails", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "DAG Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0, dependsOn: [] }),
        makeTask("t-2", { orderIndex: 1, dependsOn: ["t-1"] }),
        makeTask("t-3", { orderIndex: 2, dependsOn: ["t-2"] }),
      ]);

      // t-1 fails
      mockComplete.mockRejectedValueOnce(new Error("root task failed"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      // t-1 failed, t-2 and t-3 should be blocked
      expect(result.completedTasks).toBe(0);

      const taskStatuses = new Map(result.tasks.map((t) => [t.id, t.status]));
      expect(taskStatuses.get("t-1")).toBe("failed");
      expect(taskStatuses.get("t-2")).toBe("blocked");
      expect(taskStatuses.get("t-3")).toBe("blocked");

      // Verify blockTask was called for downstream tasks
      const blockCalls = mockBlockTask.mock.calls.map((c) => c[1]);
      expect(blockCalls).toContain("t-2");
      expect(blockCalls).toContain("t-3");
    });

    it("only blocks dependents, not independent tasks", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Partial DAG" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0, dependsOn: [] }),
        makeTask("t-2", { orderIndex: 1, dependsOn: ["t-1"] }),
        makeTask("t-3", { orderIndex: 2, dependsOn: [] }),  // no dependency on t-1
      ]);

      // t-1 fails, t-3 should still run and succeed
      mockComplete
        .mockRejectedValueOnce(new Error("t-1 failed"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "t-3 output" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      const taskStatuses = new Map(result.tasks.map((t) => [t.id, t.status]));
      expect(taskStatuses.get("t-1")).toBe("failed");
      expect(taskStatuses.get("t-2")).toBe("blocked");
      expect(taskStatuses.get("t-3")).toBe("completed");
      expect(result.completedTasks).toBe(1);
    });
  });

  describe("deadlock safety valve", () => {
    it("exits the DAG loop when no tasks are ready and none are running", async () => {
      // This tests the safety valve at line 421:
      // if (batch.length === 0 && running.size === 0) break;
      //
      // Scenario: all tasks have unresolvable dependencies (referencing
      // non-existent task IDs), so getReadyTasks() returns [] and running is empty.
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Deadlocked Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0, dependsOn: ["nonexistent-task"] }),
        makeTask("t-2", { orderIndex: 1, dependsOn: ["also-nonexistent"] }),
      ]);

      const dispatcher = createDispatcher();

      // If the safety valve didn't work, this would hang and hit the timeout
      const result = await dispatcher.runGoal("g-1");

      // No tasks could run, so nothing completed
      expect(result.completedTasks).toBe(0);
      // The loop exits cleanly without hanging. Since no tasks failed or ran,
      // the empty taskResults array makes `every(t => t.status === "completed")`
      // vacuously true, so the dispatcher reports "completed".
      expect(result.status).toBe("completed");
      // The key assertion is that we reached this point without timing out,
      // proving the safety valve broke the loop.
    }, 5_000);
  });

  describe("pending approval pauses execution", () => {
    it("stops execution chain when a task has a pending approval (grouped path)", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Needs Approval" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0, assignedAgent: "coder" }),
        makeTask("t-2", { orderIndex: 1, assignedAgent: "reviewer" }),
      ]);

      // First task has pending approval
      mockListPendingApprovalsForTasks.mockResolvedValueOnce([
        { id: "a-1", taskId: "t-1", status: "pending" },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      // The first task should report awaiting_approval
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].status).toBe("awaiting_approval");
      expect(result.tasks[0].id).toBe("t-1");

      // No tasks should have been assigned or started
      expect(mockAssignTask).not.toHaveBeenCalled();
      expect(mockStartTask).not.toHaveBeenCalled();
    });

    it("stops execution in DAG mode when task has pending approval", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "DAG Approval" });
      mockListTasksByGoal.mockResolvedValueOnce([
        makeTask("t-1", { orderIndex: 0, dependsOn: [] }),
        makeTask("t-2", { orderIndex: 1, dependsOn: ["t-1"] }),
      ]);

      // t-1 has a pending approval
      mockListPendingApprovalsForTasks.mockResolvedValueOnce([
        { id: "a-1", taskId: "t-1", status: "pending" },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      // t-1 should be reported as awaiting_approval
      const t1 = result.tasks.find((t) => t.id === "t-1");
      expect(t1?.status).toBe("awaiting_approval");

      // t-2 should NOT have been executed (it depends on t-1 which is blocked by approval)
      expect(mockAssignTask).not.toHaveBeenCalled();
      expect(mockStartTask).not.toHaveBeenCalled();
    });
  });
});
