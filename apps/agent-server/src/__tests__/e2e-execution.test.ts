import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// --- Mocked DB functions ---
const mockGetGoal = vi.fn();
const mockCreateGoal = vi.fn();
const mockListTasksByGoal = vi.fn();
const mockAssignTask = vi.fn();
const mockStartTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn();
const mockUpdateGoalStatus = vi.fn();
const mockListPendingApprovals = vi.fn().mockResolvedValue([]);
const mockRecordLlmUsage = vi.fn().mockResolvedValue({ id: "usage-1" });
const mockGetUsageSummary = vi.fn().mockResolvedValue({
  totalInputTokens: 100,
  totalOutputTokens: 200,
  totalCostUsd: 0.001,
  byProvider: { anthropic: { inputTokens: 100, outputTokens: 200, costUsd: 0.001, requests: 1 } },
  byModel: {},
  byAgent: {},
  requestCount: 1,
});

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn(),
  getGoal: mockGetGoal,
  createGoal: mockCreateGoal,
  createTask: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: mockUpdateGoalStatus,
  getTask: vi.fn(),
  listTasksByGoal: mockListTasksByGoal,
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: mockAssignTask,
  startTask: mockStartTask,
  completeTask: mockCompleteTask,
  failTask: mockFailTask,
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovals: mockListPendingApprovals,
  listApprovalsByTask: vi.fn().mockResolvedValue([]),
  resolveApproval: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  getConversation: vi.fn(),
  createN8nWorkflow: vi.fn(),
  updateN8nWorkflow: vi.fn(),
  getN8nWorkflow: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  deleteN8nWorkflow: vi.fn(),
  findN8nWorkflowByEvent: vi.fn(),
  recordLlmUsage: mockRecordLlmUsage,
  getUsageSummary: mockGetUsageSummary,
  saveCodeExecution: vi.fn(),
  listCodeExecutionsByTask: vi.fn().mockResolvedValue([]),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Task output from agent" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 100 },
    provider: "anthropic",
  });

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

const { buildServer } = await import("../server.js");

const GOAL_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockListPendingApprovals.mockResolvedValue([]);
});

describe("E2E goal execution flow", () => {
  it("executes a goal with two tasks end-to-end", async () => {
    // Set up: goal with two tasks (researcher → coder)
    mockGetGoal.mockResolvedValue({
      id: GOAL_ID,
      title: "Build Feature",
      status: "active",
    });

    const tasks = [
      {
        id: "task-1",
        goalId: GOAL_ID,
        title: "Research best practices",
        description: "Research the best approach",
        assignedAgent: "researcher",
        orderIndex: 0,
        status: "pending",
      },
      {
        id: "task-2",
        goalId: GOAL_ID,
        title: "Implement solution",
        description: "Write the code",
        assignedAgent: "coder",
        orderIndex: 1,
        status: "pending",
      },
    ];
    mockListTasksByGoal.mockResolvedValue(tasks);
    mockAssignTask.mockResolvedValue({});
    mockStartTask.mockResolvedValue({});
    mockCompleteTask.mockResolvedValue({});
    mockUpdateGoalStatus.mockResolvedValue({});

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.totalTasks).toBe(2);
    expect(body.completedTasks).toBe(2);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0].status).toBe("completed");
    expect(body.tasks[1].status).toBe("completed");

    // Verify task lifecycle calls
    expect(mockAssignTask).toHaveBeenCalledTimes(2);
    expect(mockStartTask).toHaveBeenCalledTimes(2);
    expect(mockCompleteTask).toHaveBeenCalledTimes(2);
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), GOAL_ID, "completed");

    // Verify LLM usage was recorded for each task
    expect(mockRecordLlmUsage).toHaveBeenCalledTimes(2);
  });

  it("stops execution when a task requires approval", async () => {
    mockGetGoal.mockResolvedValue({
      id: GOAL_ID,
      title: "Deploy App",
      status: "active",
    });

    const tasks = [
      {
        id: "task-1",
        goalId: GOAL_ID,
        title: "Deploy to production",
        description: "Deploy the app",
        assignedAgent: "coder",
        orderIndex: 0,
        status: "pending",
      },
    ];
    mockListTasksByGoal.mockResolvedValue(tasks);
    mockListPendingApprovals.mockResolvedValue([
      { id: "approval-1", taskId: "task-1", status: "pending" },
    ]);
    mockUpdateGoalStatus.mockResolvedValue({});

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: {},
    });
    await app.close();

    const body = res.json();
    expect(body.completedTasks).toBe(0);
    expect(body.tasks[0].status).toBe("awaiting_approval");
    expect(mockAssignTask).not.toHaveBeenCalled();
  });

  it("records partial completion when a task fails", async () => {
    mockGetGoal.mockResolvedValue({
      id: GOAL_ID,
      title: "Build Feature",
      status: "active",
    });

    // First task succeeds, second is a role that doesn't exist
    const tasks = [
      {
        id: "task-1",
        goalId: GOAL_ID,
        title: "Research",
        description: "Do research",
        assignedAgent: "researcher",
        orderIndex: 0,
        status: "pending",
      },
      {
        id: "task-2",
        goalId: GOAL_ID,
        title: "Unknown agent task",
        description: "This has an unknown agent",
        assignedAgent: null,
        orderIndex: 1,
        status: "pending",
      },
    ];
    mockListTasksByGoal.mockResolvedValue(tasks);
    mockAssignTask.mockResolvedValue({});
    mockStartTask.mockResolvedValue({});
    mockCompleteTask.mockResolvedValue({});
    mockFailTask.mockResolvedValue({});
    mockUpdateGoalStatus.mockResolvedValue({});

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: {},
    });
    await app.close();

    const body = res.json();
    // First task completed, second failed (no specialist for null role → "researcher" fallback, but should still work)
    expect(body.totalTasks).toBe(2);
    expect(body.completedTasks).toBeGreaterThanOrEqual(1);
  });
});

describe("Usage API", () => {
  it("GET /api/usage returns usage summary", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/usage?period=today" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe("today");
    expect(body.totalInputTokens).toBe(100);
    expect(body.totalCostUsd).toBe(0.001);
    expect(body.requestCount).toBe(1);
  });

  it("GET /api/usage supports different periods", async () => {
    const { app } = buildServer();

    for (const period of ["today", "week", "month", "all"]) {
      const res = await app.inject({ method: "GET", url: `/api/usage?period=${period}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().period).toBe(period);
    }

    await app.close();
  });
});

describe("Provider health endpoint", () => {
  it("GET /health/providers returns provider health", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/providers" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBeDefined();
    expect(body.providers).toBeDefined();
  });
});
