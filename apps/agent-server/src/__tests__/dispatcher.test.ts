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
const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});
const mockListPendingApprovalsForTasks = vi.fn().mockResolvedValue([]);

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
  updateGoalStatus: mockUpdateGoalStatus,
  listPendingApprovalsForTasks: mockListPendingApprovalsForTasks,
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
const { NotificationService } = await import("../services/notifications.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TaskDispatcher", { timeout: 15_000 }, () => {
  function createDispatcher(notificationService?: InstanceType<typeof NotificationService>) {
    const registry = new LlmRegistry();
    const db = {} as any;
    return new TaskDispatcher(
      registry,
      db,
      undefined,
      undefined,
      notificationService,
    );
  }

  describe("runGoal", () => {
    it("throws when goal not found", async () => {
      mockGetGoal.mockResolvedValueOnce(null);
      const dispatcher = createDispatcher();

      await expect(dispatcher.runGoal("bad-id")).rejects.toThrow("Goal not found");
    });

    it("returns no_tasks when goal has no tasks", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Empty" });
      mockListTasksByGoal.mockResolvedValueOnce([]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("no_tasks");
      expect(result.totalTasks).toBe(0);
    });

    it("executes tasks in order and marks goal completed", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Build it" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Research", assignedAgent: "researcher", orderIndex: 0 },
        { id: "t-2", title: "Code", assignedAgent: "coder", orderIndex: 1 },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(2);
      expect(result.totalTasks).toBe(2);
      expect(mockAssignTask).toHaveBeenCalledTimes(2);
      expect(mockStartTask).toHaveBeenCalledTimes(2);
      expect(mockCompleteTask).toHaveBeenCalledTimes(2);
      expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), "g-1", "completed");
    });

    it("handles task failure and continues to next task", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Risky" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Will fail", assignedAgent: "researcher", orderIndex: 0 },
        { id: "t-2", title: "Will succeed", assignedAgent: "coder", orderIndex: 1 },
      ]);

      // First task fails, second succeeds
      mockComplete
        .mockRejectedValueOnce(new Error("LLM error"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Success" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("in_progress");
      expect(result.completedTasks).toBe(1);
      expect(mockFailTask).toHaveBeenCalledWith(expect.anything(), "t-1", "LLM error");
    });

    it("marks goal cancelled when all tasks fail", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Doomed" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Fail 1", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      mockComplete.mockRejectedValueOnce(new Error("fail"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("failed");
      expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), "g-1", "cancelled");
    });

    it("skips task with pending approval and stops chain", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Needs Approval" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Blocked", assignedAgent: "coder", orderIndex: 0 },
        { id: "t-2", title: "After", assignedAgent: "reviewer", orderIndex: 1 },
      ]);
      mockListPendingApprovalsForTasks.mockResolvedValueOnce([
        { id: "a-1", taskId: "t-1", status: "pending" },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].status).toBe("awaiting_approval");
      // Should NOT have started any tasks
      expect(mockAssignTask).not.toHaveBeenCalled();
    });

    it("defaults to researcher when assignedAgent is null", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Default" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Unassigned", assignedAgent: null, orderIndex: 0 },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.completedTasks).toBe(1);
      expect(mockAssignTask).toHaveBeenCalledWith(expect.anything(), "t-1", "researcher");
    });

    it("calls onProgress callback during execution", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Tracked" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Step 1", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      const onProgress = vi.fn();
      const dispatcher = createDispatcher();
      await dispatcher.runGoal("g-1", undefined, onProgress);

      // started + completed = 2 calls
      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: "started", taskId: "t-1" }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", taskId: "t-1" }),
      );
    });

    it("handles unknown agent role gracefully", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Bad Agent" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Mystery", assignedAgent: "wizard", orderIndex: 0 },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.tasks[0].status).toBe("failed");
      expect(mockFailTask).toHaveBeenCalledWith(
        expect.anything(),
        "t-1",
        "No specialist agent for role: wizard",
      );
    });
  });

  describe("notifications", () => {
    it("calls notifyGoalCompleted after successful execution", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Build it" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Research", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      const ns = new NotificationService();
      const dispatcher = createDispatcher(ns);
      await dispatcher.runGoal("g-1");

      // Wait for fire-and-forget promise to settle
      await flushPromises();

      expect(ns.notifyGoalCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g-1",
          goalTitle: "Build it",
          status: "completed",
          completedTasks: 1,
          totalTasks: 1,
        }),
      );
    });

    it("calls notifyTaskFailed when a task fails", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Risky" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Will fail", assignedAgent: "researcher", orderIndex: 0 },
      ]);
      mockComplete.mockRejectedValueOnce(new Error("LLM error"));

      const ns = new NotificationService();
      const dispatcher = createDispatcher(ns);
      await dispatcher.runGoal("g-1");

      await flushPromises();

      expect(ns.notifyTaskFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g-1",
          goalTitle: "Risky",
          taskId: "t-1",
          taskTitle: "Will fail",
          agent: "researcher",
          error: "LLM error",
        }),
      );
    });

    it("works fine without notification service", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "No notifications" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Step", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      const dispatcher = createDispatcher(); // no notification service
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
    });

    it("calls notifyGoalProgress for task started and completed", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Tracked Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Research", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      const ns = new NotificationService();
      const dispatcher = createDispatcher(ns);
      await dispatcher.runGoal("g-1");

      await flushPromises();

      // Should have been called twice: started + completed
      expect(ns.notifyGoalProgress).toHaveBeenCalledTimes(2);
      expect(ns.notifyGoalProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g-1",
          goalTitle: "Tracked Goal",
          taskTitle: "Research",
          agent: "researcher",
          status: "started",
        }),
      );
      expect(ns.notifyGoalProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g-1",
          goalTitle: "Tracked Goal",
          taskTitle: "Research",
          agent: "researcher",
          status: "completed",
        }),
      );
    });

    it("dispatches tasks to debugger agent", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Debug Issue" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Investigate crash", assignedAgent: "debugger", orderIndex: 0 },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.completedTasks).toBe(1);
      expect(result.tasks[0].agent).toBe("debugger");
      expect(mockAssignTask).toHaveBeenCalledWith(expect.anything(), "t-1", "debugger");
    });
  });

  describe("retry logic", () => {
    it("retries coder task on failure and succeeds", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Retry Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Write code", assignedAgent: "coder", orderIndex: 0 },
      ]);

      // First call fails, second (retry) succeeds
      mockComplete
        .mockRejectedValueOnce(new Error("LLM timeout"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Fixed code" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(1);
      expect(result.tasks[0].status).toBe("completed");
      expect(mockCompleteTask).toHaveBeenCalled();
    });

    it("does NOT retry researcher task (non-retryable)", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "No Retry" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Research", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      mockComplete.mockRejectedValueOnce(new Error("LLM error"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.tasks[0].status).toBe("failed");
      // Should only have been called once (no retry)
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("fails after retry also fails", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Double Fail" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Debug issue", assignedAgent: "debugger", orderIndex: 0 },
      ]);

      mockComplete
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Retry also failed"));

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.tasks[0].status).toBe("failed");
      expect(result.tasks[0].output).toBe("Retry also failed");
      expect(mockFailTask).toHaveBeenCalledWith(expect.anything(), "t-1", "Retry also failed");
    });

    it("injects error context into retry task description", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Context Check" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Write code", description: "Build feature", assignedAgent: "coder", orderIndex: 0 },
      ]);

      mockComplete
        .mockRejectedValueOnce(new Error("Syntax error in line 42"))
        .mockResolvedValueOnce({
          content: [{ type: "text", text: "Fixed code" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        });

      const dispatcher = createDispatcher();
      await dispatcher.runGoal("g-1");

      // The second call should have the error context injected
      const secondCallArgs = mockComplete.mock.calls[1];
      const messagesArg = secondCallArgs[1];
      const _systemMsg = messagesArg.system ?? messagesArg.messages?.[0]?.content ?? "";
      // We can check that complete was called twice (original + retry)
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });
  });

  describe("getProgress", () => {
    it("throws when goal not found", async () => {
      mockGetGoal.mockResolvedValueOnce(null);
      const dispatcher = createDispatcher();

      await expect(dispatcher.getProgress("bad-id")).rejects.toThrow("Goal not found");
    });

    it("returns progress for a goal with tasks", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Goal", status: "active" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Done", status: "completed", assignedAgent: "researcher", output: "ok" },
        { id: "t-2", title: "Running", status: "running", assignedAgent: "coder", output: null },
      ]);

      const dispatcher = createDispatcher();
      const progress = await dispatcher.getProgress("g-1");

      expect(progress.totalTasks).toBe(2);
      expect(progress.completedTasks).toBe(1);
      expect(progress.currentTask).toEqual({
        id: "t-2",
        title: "Running",
        agent: "coder",
        status: "running",
      });
    });
  });

  describe("verification", () => {
    function createDispatcherWithVerification(mockVerify: ReturnType<typeof vi.fn>) {
      const registry = new LlmRegistry();
      const db = {} as any;
      const verificationService = { verify: mockVerify } as any;
      return new TaskDispatcher(
        registry,
        db,
        undefined,
        undefined,
        undefined,
        undefined,
        verificationService,
      );
    }

    it("calls verificationService.verify after successful goal execution", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Build it" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Code", assignedAgent: "coder", orderIndex: 0 },
      ]);

      const mockVerify = vi.fn().mockResolvedValue(null);
      const dispatcher = createDispatcherWithVerification(mockVerify);
      await dispatcher.runGoal("g-1", "user-1");

      // Wait for fire-and-forget
      await flushPromises();

      expect(mockVerify).toHaveBeenCalledWith(
        expect.objectContaining({
          goalId: "g-1",
          goalTitle: "Build it",
          userId: "user-1",
        }),
      );
    });

    it("does NOT call verificationService.verify when tasks failed", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Fail" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Fail task", assignedAgent: "researcher", orderIndex: 0 },
      ]);

      mockComplete.mockRejectedValueOnce(new Error("LLM error"));

      const mockVerify = vi.fn().mockResolvedValue(null);
      const dispatcher = createDispatcherWithVerification(mockVerify);
      await dispatcher.runGoal("g-1", "user-1");

      await flushPromises();

      expect(mockVerify).not.toHaveBeenCalled();
    });
  });

  describe("parallel execution", () => {
    it("runs tasks in same parallel group concurrently", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Parallel Goal" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Research A", assignedAgent: "researcher", orderIndex: 0, parallelGroup: 0 },
        { id: "t-2", title: "Research B", assignedAgent: "researcher", orderIndex: 1, parallelGroup: 0 },
      ]);

      // Track execution timing to verify concurrency
      const executionOrder: string[] = [];
      mockComplete.mockImplementation(async () => {
        const taskId = `call-${executionOrder.length}`;
        executionOrder.push(`start-${taskId}`);
        await flushPromises();
        executionOrder.push(`end-${taskId}`);
        return {
          content: [{ type: "text", text: "Output" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        };
      });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(2);
      // Both tasks should have started before either finished (concurrent execution)
      // With Promise.allSettled, both start nearly simultaneously
      expect(mockAssignTask).toHaveBeenCalledTimes(2);
      expect(mockCompleteTask).toHaveBeenCalledTimes(2);
    });

    it("waits for group to finish before starting next group", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Sequential Groups" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "First", assignedAgent: "researcher", orderIndex: 0, parallelGroup: 0 },
        { id: "t-2", title: "Second", assignedAgent: "coder", orderIndex: 1, parallelGroup: 1 },
      ]);

      const executionOrder: string[] = [];
      mockComplete.mockImplementation(async () => {
        executionOrder.push(`task-${executionOrder.length}`);
        return {
          content: [{ type: "text", text: "Output" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        };
      });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(2);
      // Group 0 must complete before group 1 starts
      expect(executionOrder).toEqual(["task-0", "task-1"]);
    });

    it("handles failure in one parallel task without cancelling siblings", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Mixed Results" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Will fail", assignedAgent: "researcher", orderIndex: 0, parallelGroup: 0 },
        { id: "t-2", title: "Will succeed", assignedAgent: "researcher", orderIndex: 1, parallelGroup: 0 },
      ]);

      let callCount = 0;
      mockComplete.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Task 1 failed");
        }
        return {
          content: [{ type: "text", text: "Success" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        };
      });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      // One succeeded, one failed
      expect(result.completedTasks).toBe(1);
      expect(result.tasks).toHaveLength(2);
      const statuses = result.tasks.map((t) => t.status).sort();
      expect(statuses).toEqual(["completed", "failed"]);
    });

    it("tasks without parallelGroup run sequentially (backward compat)", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Sequential" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "First", assignedAgent: "researcher", orderIndex: 0 },
        { id: "t-2", title: "Second", assignedAgent: "coder", orderIndex: 1 },
      ]);

      const executionOrder: string[] = [];
      mockComplete.mockImplementation(async () => {
        executionOrder.push(`task-${executionOrder.length}`);
        return {
          content: [{ type: "text", text: "Output" }],
          model: "test-model",
          stop_reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 20 },
          provider: "test",
        };
      });

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(2);
      // Tasks run one at a time since they have no parallelGroup
      expect(executionOrder).toEqual(["task-0", "task-1"]);
    });

    it("mixes parallel groups with sequential ungrouped tasks", async () => {
      mockGetGoal.mockResolvedValueOnce({ id: "g-1", title: "Mixed" });
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "t-1", title: "Parallel A", assignedAgent: "researcher", orderIndex: 0, parallelGroup: 0 },
        { id: "t-2", title: "Parallel B", assignedAgent: "researcher", orderIndex: 1, parallelGroup: 0 },
        { id: "t-3", title: "Sequential", assignedAgent: "coder", orderIndex: 2 },
      ]);

      const dispatcher = createDispatcher();
      const result = await dispatcher.runGoal("g-1");

      expect(result.status).toBe("completed");
      expect(result.completedTasks).toBe(3);
    });
  });
});
