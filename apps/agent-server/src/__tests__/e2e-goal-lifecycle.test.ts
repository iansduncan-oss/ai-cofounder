import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// Set env BEFORE any dynamic imports — server reads DATABASE_URL at plugin registration time
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

// --- Controllable mock fns for assertions ---
const mockCreateGoal = vi.fn().mockResolvedValue({ id: "goal-e2e-1", status: "active" });
const mockGetGoal = vi.fn();
const mockCreateTask = vi.fn().mockResolvedValue({ id: "task-e2e-1" });
const mockListTasksByGoal = vi.fn().mockResolvedValue([]);
const mockListGoalsByConversation = vi.fn().mockResolvedValue([]);
const mockUpdateGoalStatus = vi.fn();
const mockListPendingTasks = vi.fn().mockResolvedValue([]);
const mockStartTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  listGoalsByConversation: (...args: unknown[]) => mockListGoalsByConversation(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  listTasksByGoal: (...args: unknown[]) => mockListTasksByGoal(...args),
  listPendingTasks: (...args: unknown[]) => mockListPendingTasks(...args),
  startTask: (...args: unknown[]) => mockStartTask(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  failTask: (...args: unknown[]) => mockFailTask(...args),
}));

// Mock @ai-cofounder/queue
vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-e2e-123"),
  enqueueReflection: vi.fn().mockResolvedValue(undefined),
  enqueueRagIngestion: vi.fn().mockResolvedValue("job-mock"),
  enqueuePipeline: vi.fn().mockResolvedValue("job-mock"),
  getPipelineQueue: vi.fn().mockReturnValue(null),
  getJobStatus: vi.fn().mockResolvedValue(null),
  goalChannel: vi.fn().mockReturnValue("goal:test"),
  pingRedis: vi.fn().mockResolvedValue(false),
}));

// Mock @ai-cofounder/llm with a class-based MockLlmRegistry
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
    seedStats = vi.fn();
    getStatsSnapshots = vi.fn().mockReturnValue([]);
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

// Dynamic imports AFTER env vars are set and mocks are in place
const { buildServer } = await import("../server.js");
const { toolUseResponse, textResponse } = await import("@ai-cofounder/test-utils");

// ------------------------------------------------------------------
// Goal lifecycle tests — mocked DB, scripted LLM responses
// ------------------------------------------------------------------
describe("E2E goal lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates goal via POST /api/agents/run and verifies mock calls", async () => {
    // Script the LLM sequence:
    // First call: orchestrator returns create_plan tool use
    mockComplete.mockResolvedValueOnce(
      toolUseResponse("create_plan", {
        goal_title: "E2E Test Goal",
        goal_description: "Test the lifecycle",
        goal_priority: "low",
        tasks: [
          {
            title: "Research task",
            description: "Do research",
            assigned_agent: "researcher",
          },
        ],
      }),
    );
    // Second call: orchestrator text response after plan is created
    mockComplete.mockResolvedValueOnce(textResponse("Plan created. Tasks queued."));

    const { app } = buildServer();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Build a test feature", userId: "e2e-test-user" },
      });

      expect(res.statusCode).toBe(200);

      const body = res.json();

      // Verify the orchestrator processed the message and invoked the LLM
      expect(mockComplete).toHaveBeenCalled();
      expect(body.response).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("dispatches goal tasks to completion via TaskDispatcher.runGoal()", async () => {
    const goalId = "goal-dispatch-1";
    mockCreateGoal.mockResolvedValueOnce({ id: goalId, status: "active" });

    // Script LLM sequence for plan creation via the orchestrator
    mockComplete.mockResolvedValueOnce(
      toolUseResponse("create_plan", {
        goal_title: "E2E Dispatch Goal",
        goal_description: "Dispatch to completion",
        goal_priority: "low",
        tasks: [
          {
            title: "Research task",
            description: "Do research",
            assigned_agent: "researcher",
          },
        ],
      }),
    );
    mockComplete.mockResolvedValueOnce(textResponse("Plan created. Tasks queued."));

    // Script dispatcher responses
    mockComplete.mockResolvedValueOnce(textResponse("Research complete. Found relevant information."));
    mockComplete.mockResolvedValueOnce(textResponse("Self-improvement analysis complete."));
    mockComplete.mockResolvedValueOnce(textResponse("Done."));

    // Set up mock returns for dispatcher flow
    mockGetGoal.mockResolvedValue({ id: goalId, status: "active", title: "E2E Dispatch Goal" });
    mockListTasksByGoal.mockResolvedValue([
      {
        id: "task-d-1",
        goalId,
        title: "Research task",
        description: "Do research",
        status: "pending",
        assignedAgent: "researcher",
        orderIndex: 0,
      },
    ]);
    mockListPendingTasks.mockResolvedValue([]);

    const { app } = buildServer();
    try {
      // Step 1: Create goal + tasks via POST /api/agents/run
      const runRes = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Build a dispatch test feature", userId: "e2e-dispatch-user" },
      });

      expect(runRes.statusCode).toBe(200);

      // Step 2: Run dispatcher
      const { TaskDispatcher } = await import("../agents/dispatcher.js");
      const dispatcher = new TaskDispatcher(
        app.llmRegistry,
        app.db,
        undefined, // embeddingService
        undefined, // sandboxService
        undefined, // notificationService
        undefined, // workspaceService
        undefined, // verificationService
      );

      const result = await dispatcher.runGoal(goalId);

      // Step 3: Verify the result
      expect(result.status).toBe("completed");
      expect(mockUpdateGoalStatus).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("verifies mocks are clean between test runs", () => {
    // beforeEach clears all mocks, so controllable mocks should have zero calls
    expect(mockCreateGoal).not.toHaveBeenCalled();
    expect(mockGetGoal).not.toHaveBeenCalled();
    expect(mockListGoalsByConversation).not.toHaveBeenCalled();
  });
});
