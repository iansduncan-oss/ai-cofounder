import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockCreateSchedule = vi.fn();
const mockListSchedules = vi.fn().mockResolvedValue([]);
const mockGetSchedule = vi.fn();
const mockDeleteSchedule = vi.fn();
const mockToggleSchedule = vi.fn();

vi.mock("@ai-cofounder/db", () => new Proxy({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
  listSchedules: (...args: unknown[]) => mockListSchedules(...args),
  getSchedule: (...args: unknown[]) => mockGetSchedule(...args),
  deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
  toggleSchedule: (...args: unknown[]) => mockToggleSchedule(...args),
  // Required by other imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
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
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
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
  listSchedules: (...args: unknown[]) => mockListSchedules(...args),
  createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}, {
    get(target: Record<string, unknown>, prop: string | symbol, receiver: unknown) {
      if (typeof prop === "string" && !(prop in target)) {
        const fn = vi.fn().mockResolvedValue(null);
        target[prop] = fn;
        return fn;
      }
      return Reflect.get(target, prop, receiver);
    },
    has() { return true; },
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
  mockListSchedules.mockResolvedValue([]);
});

describe("Schedule routes", () => {
  it("POST /api/schedules — creates a schedule with valid cron", async () => {
    const schedule = {
      id: UUID,
      cronExpression: "0 9 * * 1-5",
      actionPrompt: "Review PRs",
      enabled: true,
    };
    mockCreateSchedule.mockResolvedValueOnce(schedule);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/schedules",
      payload: {
        cronExpression: "0 9 * * 1-5",
        actionPrompt: "Review PRs",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(mockCreateSchedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cronExpression: "0 9 * * 1-5",
        actionPrompt: "Review PRs",
        enabled: true,
      }),
    );
  });

  it("POST /api/schedules — rejects invalid cron expression", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/schedules",
      payload: {
        cronExpression: "not-valid-cron",
        actionPrompt: "Do something",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Invalid cron");
  });

  it("GET /api/schedules — lists schedules", async () => {
    mockListSchedules.mockResolvedValueOnce([
      { id: UUID, cronExpression: "0 9 * * *", actionPrompt: "Test", enabled: true },
    ]);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/schedules" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("GET /api/schedules/:id — returns schedule when found", async () => {
    mockGetSchedule.mockResolvedValueOnce({
      id: UUID,
      cronExpression: "0 9 * * *",
      actionPrompt: "Morning check",
      enabled: true,
    });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/schedules/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().actionPrompt).toBe("Morning check");
  });

  it("GET /api/schedules/:id — returns 404 when not found", async () => {
    mockGetSchedule.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/schedules/${UUID}` });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/schedules/:id/toggle — toggles schedule", async () => {
    mockToggleSchedule.mockResolvedValueOnce({
      id: UUID,
      enabled: false,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/schedules/${UUID}/toggle`,
      payload: { enabled: false },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(mockToggleSchedule).toHaveBeenCalledWith(expect.anything(), UUID, false);
  });

  it("PATCH /api/schedules/:id/toggle — returns 404 when not found", async () => {
    mockToggleSchedule.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/schedules/${UUID}/toggle`,
      payload: { enabled: true },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/schedules/:id — deletes schedule", async () => {
    mockDeleteSchedule.mockResolvedValueOnce({ id: UUID });

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/schedules/${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("DELETE /api/schedules/:id — returns 404 when not found", async () => {
    mockDeleteSchedule.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/schedules/${UUID}`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});
