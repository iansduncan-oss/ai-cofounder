import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Set env before any imports that read it
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

// --- Mocked DB functions with controllable return values ---
const mockGetGoal = vi.fn();
const mockCreateGoal = vi.fn();
const mockListGoalsByConversation = vi.fn().mockResolvedValue([]);
const mockCountGoalsByConversation = vi.fn().mockResolvedValue(0);
const mockUpdateGoalStatus = vi.fn();
const mockGetTask = vi.fn();
const mockCreateTask = vi.fn();
const mockListTasksByGoal = vi.fn().mockResolvedValue([]);
const mockCountTasksByGoal = vi.fn().mockResolvedValue(0);
const mockListPendingTasks = vi.fn().mockResolvedValue([]);
const mockAssignTask = vi.fn();
const mockStartTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn();
const mockCreateApproval = vi.fn();
const mockGetApproval = vi.fn();
const mockListPendingApprovals = vi.fn().mockResolvedValue([]);
const mockListApprovalsByTask = vi.fn().mockResolvedValue([]);
const mockResolveApproval = vi.fn();
const mockListMemoriesByUser = vi.fn().mockResolvedValue([]);
const mockCountMemoriesByUser = vi.fn().mockResolvedValue(0);
const mockDeleteMemory = vi.fn();
const mockGetChannelConversation = vi.fn();
const mockUpsertChannelConversation = vi.fn();
const mockFindUserByPlatform = vi.fn();
const mockGetActivePrompt = vi.fn();
const mockListPromptVersions = vi.fn().mockResolvedValue([]);
const mockCreatePromptVersion = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: mockGetGoal,
  createGoal: mockCreateGoal,
  listGoalsByConversation: mockListGoalsByConversation,
  countGoalsByConversation: mockCountGoalsByConversation,
  updateGoalStatus: mockUpdateGoalStatus,
  getTask: mockGetTask,
  createTask: mockCreateTask,
  listTasksByGoal: mockListTasksByGoal,
  countTasksByGoal: mockCountTasksByGoal,
  listPendingTasks: mockListPendingTasks,
  assignTask: mockAssignTask,
  startTask: mockStartTask,
  completeTask: mockCompleteTask,
  failTask: mockFailTask,
  createApproval: mockCreateApproval,
  getApproval: mockGetApproval,
  listPendingApprovals: mockListPendingApprovals,
  listApprovalsByTask: mockListApprovalsByTask,
  resolveApproval: mockResolveApproval,
  listMemoriesByUser: mockListMemoriesByUser,
  countMemoriesByUser: mockCountMemoriesByUser,
  deleteMemory: mockDeleteMemory,
  getChannelConversation: mockGetChannelConversation,
  upsertChannelConversation: mockUpsertChannelConversation,
  findUserByPlatform: mockFindUserByPlatform,
  getActivePrompt: mockGetActivePrompt,
  listPromptVersions: mockListPromptVersions,
  createPromptVersion: mockCreatePromptVersion,
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  createN8nWorkflow: vi.fn(),
  updateN8nWorkflow: vi.fn(),
  getN8nWorkflow: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  deleteN8nWorkflow: vi.fn(),
  findN8nWorkflowByEvent: vi.fn(),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  countEvents: vi.fn().mockResolvedValue(0),
  listEvents: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock response" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
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

const UUID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────── Goal Routes ──────────────────── */

describe("Goal routes", () => {
  it("POST /api/goals — creates a goal", async () => {
    const goal = { id: UUID, title: "Build MVP", conversationId: UUID };
    mockCreateGoal.mockResolvedValueOnce(goal);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: { conversationId: UUID, title: "Build MVP" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("Build MVP");
    expect(mockCreateGoal).toHaveBeenCalled();
  });

  it("GET /api/goals/:id — returns goal when found", async () => {
    const goal = { id: UUID, title: "Build MVP", status: "draft" };
    mockGetGoal.mockResolvedValueOnce(goal);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/goals/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Build MVP");
  });

  it("GET /api/goals/:id — returns 404 when not found", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/goals/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/goals?conversationId — lists goals (paginated)", async () => {
    mockListGoalsByConversation.mockResolvedValueOnce([
      { id: UUID, title: "Goal 1" },
    ]);
    mockCountGoalsByConversation.mockResolvedValueOnce(1);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals?conversationId=${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("GET /api/goals?conversationId&limit&offset — respects pagination params", async () => {
    mockListGoalsByConversation.mockResolvedValueOnce([]);
    mockCountGoalsByConversation.mockResolvedValueOnce(25);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals?conversationId=${UUID}&limit=10&offset=20`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(20);
    expect(body.total).toBe(25);
    expect(mockListGoalsByConversation).toHaveBeenCalledWith(
      expect.anything(),
      UUID,
      { limit: 10, offset: 20 },
    );
  });

  it("PATCH /api/goals/:id/status — updates status", async () => {
    const updated = { id: UUID, status: "active" };
    mockUpdateGoalStatus.mockResolvedValueOnce(updated);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/goals/${UUID}/status`,
      payload: { status: "active" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
  });

  it("PATCH /api/goals/:id/status — 404 when not found", async () => {
    mockUpdateGoalStatus.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/goals/${UUID}/status`,
      payload: { status: "completed" },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

/* ──────────────────── Task Routes ──────────────────── */

describe("Task routes", () => {
  it("POST /api/tasks — creates a task", async () => {
    const task = { id: UUID, title: "Research", goalId: UUID };
    mockCreateTask.mockResolvedValueOnce(task);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { goalId: UUID, title: "Research" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("Research");
  });

  it("GET /api/tasks/:id — returns task", async () => {
    mockGetTask.mockResolvedValueOnce({ id: UUID, title: "Research" });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/tasks/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("GET /api/tasks/:id — 404 when not found", async () => {
    mockGetTask.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/tasks/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/tasks/pending — lists pending tasks", async () => {
    mockListPendingTasks.mockResolvedValueOnce([{ id: UUID, status: "pending" }]);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/tasks/pending" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("PATCH /api/tasks/:id/assign — assigns task", async () => {
    mockAssignTask.mockResolvedValueOnce({ id: UUID, assignedAgent: "researcher" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${UUID}/assign`,
      payload: { agent: "researcher" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().assignedAgent).toBe("researcher");
  });

  it("PATCH /api/tasks/:id/start — starts task", async () => {
    mockStartTask.mockResolvedValueOnce({ id: UUID, status: "running" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${UUID}/start`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("running");
  });

  it("PATCH /api/tasks/:id/complete — completes task", async () => {
    mockCompleteTask.mockResolvedValueOnce({ id: UUID, status: "completed", output: "done" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${UUID}/complete`,
      payload: { result: "done" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("completed");
  });

  it("PATCH /api/tasks/:id/fail — fails task", async () => {
    mockFailTask.mockResolvedValueOnce({ id: UUID, status: "failed", error: "oops" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${UUID}/fail`,
      payload: { error: "oops" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("failed");
  });
});

/* ──────────────────── Approval Routes ──────────────────── */

describe("Approval routes", () => {
  it("POST /api/approvals — creates approval", async () => {
    const approval = { id: UUID, taskId: UUID, status: "pending" };
    mockCreateApproval.mockResolvedValueOnce(approval);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/approvals",
      payload: { taskId: UUID, requestedBy: "coder", reason: "Need review" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
  });

  it("GET /api/approvals/:id — returns approval", async () => {
    mockGetApproval.mockResolvedValueOnce({ id: UUID, status: "pending" });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/approvals/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("GET /api/approvals/:id — 404 when not found", async () => {
    mockGetApproval.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/approvals/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/approvals/pending — lists pending", async () => {
    // Use persistent mock so scheduler's async tick doesn't consume the value
    mockListPendingApprovals.mockResolvedValue([{ id: UUID }]);
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/approvals/pending" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("PATCH /api/approvals/:id/resolve — resolves approval", async () => {
    mockResolveApproval.mockResolvedValueOnce({ id: UUID, status: "approved" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/approvals/${UUID}/resolve`,
      payload: { status: "approved", decision: "Looks good" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
  });

  it("PATCH /api/approvals/:id/resolve — 404 when not found", async () => {
    mockResolveApproval.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/approvals/${UUID}/resolve`,
      payload: { status: "rejected", decision: "No" },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

/* ──────────────────── Channel Routes ──────────────────── */

describe("Channel routes", () => {
  it("GET /api/channels/:channelId/conversation — returns conversation", async () => {
    mockGetChannelConversation.mockResolvedValueOnce({
      channelId: "ch-1",
      conversationId: "conv-1",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/channels/ch-1/conversation",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().conversationId).toBe("conv-1");
  });

  it("GET /api/channels/:channelId/conversation — 404 when no mapping", async () => {
    mockGetChannelConversation.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/channels/ch-unknown/conversation",
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("PUT /api/channels/:channelId/conversation — upserts mapping", async () => {
    mockUpsertChannelConversation.mockResolvedValueOnce({
      channelId: "ch-1",
      conversationId: "conv-2",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/channels/ch-1/conversation",
      payload: { conversationId: "conv-2" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().conversationId).toBe("conv-2");
  });
});

/* ──────────────────── Memory Routes ──────────────────── */

describe("Memory routes", () => {
  it("GET /api/memories?userId — lists memories (paginated)", async () => {
    mockListMemoriesByUser.mockResolvedValueOnce([
      { id: UUID, key: "pref", content: "likes coffee" },
    ]);
    mockCountMemoriesByUser.mockResolvedValueOnce(1);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/memories?userId=${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("GET /api/memories — 400 without userId", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/memories" });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("DELETE /api/memories/:id — deletes memory", async () => {
    mockDeleteMemory.mockResolvedValueOnce({ id: UUID });

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/memories/${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("DELETE /api/memories/:id — 404 when not found", async () => {
    mockDeleteMemory.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/memories/${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

/* ──────────────────── User Routes ──────────────────── */

describe("User routes", () => {
  it("GET /api/users/by-platform/:platform/:externalId — returns user", async () => {
    mockFindUserByPlatform.mockResolvedValueOnce({
      id: UUID,
      platform: "discord",
      externalId: "123",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/users/by-platform/discord/123",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().platform).toBe("discord");
  });

  it("GET /api/users/by-platform/:platform/:externalId — 404 when not found", async () => {
    mockFindUserByPlatform.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/users/by-platform/discord/999",
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

/* ──────────────────── Prompt Routes ──────────────────── */

describe("Prompt routes", () => {
  it("GET /api/prompts/:name — returns active prompt", async () => {
    mockGetActivePrompt.mockResolvedValueOnce({
      id: UUID,
      name: "system",
      version: 2,
      content: "You are an AI cofounder",
      isActive: true,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/prompts/system",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("system");
    expect(res.json().version).toBe(2);
  });

  it("GET /api/prompts/:name — 404 when not found", async () => {
    mockGetActivePrompt.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/prompts/nonexistent",
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/prompts/:name/versions — lists versions", async () => {
    mockListPromptVersions.mockResolvedValueOnce([
      { id: UUID, name: "system", version: 2 },
      { id: "p-2", name: "system", version: 1 },
    ]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/prompts/system/versions",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("POST /api/prompts — creates new version", async () => {
    mockCreatePromptVersion.mockResolvedValueOnce({
      id: UUID,
      name: "system",
      version: 3,
      content: "new prompt",
      isActive: true,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/prompts",
      payload: { name: "system", content: "new prompt" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(3);
  });
});

/* ──────────────────── Execution Routes ──────────────────── */

// NOTE: Execution route tests use x-forwarded-for to avoid IP ban
// from accumulated 404s in earlier test suites (security plugin uses module-level state)

describe("Execution routes", () => {
  const headers = { "x-forwarded-for": "10.0.0.99" };

  it("POST /api/goals/:id/execute — 404 when goal not found", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: {},
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/goals/:id/progress — 404 when goal not found", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/progress`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("POST /api/goals/:id/execute — returns no_tasks for empty goal", async () => {
    mockGetGoal.mockResolvedValueOnce({ id: UUID, title: "Empty Goal" });
    mockListTasksByGoal.mockResolvedValueOnce([]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: {},
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("no_tasks");
  });

  it("POST /api/goals/:id/execute — executes tasks and returns completed", async () => {
    mockGetGoal.mockResolvedValue({ id: UUID, title: "Build Feature", status: "draft" });
    mockListTasksByGoal.mockResolvedValueOnce([
      { id: "t-1", title: "Research", assignedAgent: "researcher", description: "Research stuff", orderIndex: 0, status: "pending" },
    ]);
    mockListPendingApprovals.mockResolvedValue([]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: {},
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goalTitle).toBe("Build Feature");
    expect(body.totalTasks).toBe(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].agent).toBe("researcher");
  });

  it("GET /api/goals/:id/progress — returns progress for existing goal", async () => {
    mockGetGoal.mockResolvedValueOnce({ id: UUID, title: "Build Feature", status: "active" });
    mockListTasksByGoal.mockResolvedValueOnce([
      { id: "t-1", title: "Research", assignedAgent: "researcher", status: "completed", output: "Done" },
      { id: "t-2", title: "Code", assignedAgent: "coder", status: "running", output: null },
    ]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/progress`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goalTitle).toBe("Build Feature");
    expect(body.totalTasks).toBe(2);
    expect(body.completedTasks).toBe(1);
    expect(body.currentTask).toBeDefined();
    expect(body.currentTask.title).toBe("Code");
    expect(body.tasks).toHaveLength(2);
  });
});
