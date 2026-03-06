import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockCreateEvent = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createEvent: (...args: unknown[]) => mockCreateEvent(...args),
  // Required by transitive imports
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn().mockResolvedValue({ id: "g-1", title: "Test" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn().mockResolvedValue({ id: "t-1" }),
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
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn(),
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

describe("Event routes", () => {
  it("POST /api/events/inbound — accepts an event and returns 202", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-1",
      source: "github",
      type: "push",
      payload: { ref: "refs/heads/main" },
      processed: false,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/events/inbound",
      payload: {
        source: "github",
        type: "push",
        payload: { ref: "refs/heads/main" },
      },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().eventId).toBe("evt-1");
    expect(res.json().status).toBe("accepted");
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "github",
        type: "push",
      }),
    );
  });

  it("POST /api/events/inbound — accepts event without payload", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "evt-2",
      source: "cron",
      type: "tick",
      payload: {},
      processed: false,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/events/inbound",
      payload: {
        source: "cron",
        type: "tick",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("POST /api/events/inbound — rejects missing source", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/events/inbound",
      payload: {
        type: "push",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/events/inbound — rejects missing type", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/events/inbound",
      payload: {
        source: "github",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});
