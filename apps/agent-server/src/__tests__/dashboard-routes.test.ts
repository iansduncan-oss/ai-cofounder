import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// Set briefing hour to 25 (impossible) so scheduler won't consume mocks
process.env.BRIEFING_HOUR = "25";

const mockListActiveGoals = vi.fn().mockResolvedValue([]);
const mockCountTasksByStatus = vi.fn().mockResolvedValue({});
const mockListEvents = vi.fn().mockResolvedValue([]);
const mockGetUsageSummary = vi.fn().mockResolvedValue({
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  byProvider: {},
  byModel: {},
  byAgent: {},
  requestCount: 0,
});

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  listEvents: (...args: unknown[]) => mockListEvents(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  // Required by transitive imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listApprovalsByTask: vi.fn().mockResolvedValue([]),
  resolveApproval: vi.fn(),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  countMemoriesByUser: vi.fn().mockResolvedValue(0),
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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
  createEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
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
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  });
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([
      { provider: "anthropic", available: true, totalRequests: 100, successCount: 99, errorCount: 1, avgLatencyMs: 500, recentErrors: [] },
    ]);
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Dashboard routes", () => {
  it("GET /api/dashboard/summary — returns full summary", async () => {
    mockListActiveGoals.mockResolvedValueOnce([
      { id: "g-1", title: "Build MVP", status: "active", priority: "high", createdAt: new Date(), updatedAt: new Date(), taskCount: 3, completedTaskCount: 1 },
      { id: "g-2", title: "Setup CI", status: "active", priority: "medium", createdAt: new Date(), updatedAt: new Date(), taskCount: 2, completedTaskCount: 2 },
    ]);
    mockCountTasksByStatus.mockResolvedValueOnce({
      pending: 5,
      running: 2,
      completed: 10,
      failed: 1,
    });
    mockListEvents.mockResolvedValueOnce([
      { id: "evt-1", source: "github", type: "push", payload: {}, processed: true, createdAt: new Date() },
    ]);
    // Three calls to getUsageSummary (today, week, month)
    mockGetUsageSummary
      .mockResolvedValueOnce({ totalCostUsd: 0.05, totalInputTokens: 1000, totalOutputTokens: 500, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 5 })
      .mockResolvedValueOnce({ totalCostUsd: 0.25, totalInputTokens: 5000, totalOutputTokens: 2500, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 20 })
      .mockResolvedValueOnce({ totalCostUsd: 1.50, totalInputTokens: 30000, totalOutputTokens: 15000, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 100 });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Goals
    expect(body.goals.activeCount).toBe(2);
    expect(body.goals.recent).toHaveLength(2);
    expect(body.goals.recent[0].title).toBe("Build MVP");

    // Tasks
    expect(body.tasks.pendingCount).toBe(5);
    expect(body.tasks.runningCount).toBe(2);
    expect(body.tasks.completedCount).toBe(10);
    expect(body.tasks.failedCount).toBe(1);

    // Provider health
    expect(body.providerHealth).toHaveLength(1);
    expect(body.providerHealth[0].provider).toBe("anthropic");

    // Costs
    expect(body.costs.today).toBe(0.05);
    expect(body.costs.week).toBe(0.25);
    expect(body.costs.month).toBe(1.50);

    // Recent events
    expect(body.recentEvents).toHaveLength(1);
    expect(body.recentEvents[0].source).toBe("github");
  });

  it("GET /api/dashboard/summary — works with empty data", async () => {
    mockListActiveGoals.mockResolvedValueOnce([]);
    mockCountTasksByStatus.mockResolvedValueOnce({});
    mockListEvents.mockResolvedValueOnce([]);
    mockGetUsageSummary
      .mockResolvedValueOnce({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 0 })
      .mockResolvedValueOnce({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 0 })
      .mockResolvedValueOnce({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 0 });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goals.activeCount).toBe(0);
    expect(body.goals.recent).toHaveLength(0);
    expect(body.tasks.pendingCount).toBe(0);
    expect(body.costs.today).toBe(0);
    expect(body.recentEvents).toHaveLength(0);
  });

  it("GET /api/dashboard/summary — limits recent goals to 5", async () => {
    const manyGoals = Array.from({ length: 8 }, (_, i) => ({
      id: `g-${i}`,
      title: `Goal ${i}`,
      status: "active",
      priority: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
      taskCount: 1,
      completedTaskCount: 0,
    }));
    mockListActiveGoals.mockResolvedValueOnce(manyGoals);
    mockCountTasksByStatus.mockResolvedValueOnce({});
    mockListEvents.mockResolvedValueOnce([]);
    mockGetUsageSummary
      .mockResolvedValue({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {}, requestCount: 0 });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goals.activeCount).toBe(8);
    expect(body.goals.recent).toHaveLength(5);
  });
});
