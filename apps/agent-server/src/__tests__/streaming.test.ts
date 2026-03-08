import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  getConversationMessageCount: vi.fn().mockResolvedValue(0),
  getLatestConversationSummary: vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn().mockResolvedValue({}),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  recordLlmUsage: vi.fn().mockResolvedValue({}),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  saveMemory: vi.fn().mockResolvedValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getActivePrompt: vi.fn(),
  getConversation: vi.fn(),
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
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  touchMemory: vi.fn(),
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
    content: [{ type: "text", text: "Streamed response" }],
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/agents/run/stream", { timeout: 15_000 }, () => {
  it("returns SSE headers", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("emits SSE events in order", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    const body = res.body;
    const events = body
      .split("\n\n")
      .filter(Boolean)
      .map((block: string) => {
        const eventLine = block.split("\n").find((l: string) => l.startsWith("event: "));
        return eventLine ? eventLine.slice(7) : null;
      })
      .filter(Boolean);

    // Should contain at least thinking and done events
    expect(events).toContain("thinking");
    expect(events).toContain("done");

    // done should come last
    expect(events[events.length - 1]).toBe("done");
  });

  it("done event contains response data", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    const blocks = res.body.split("\n\n").filter(Boolean);
    const doneBlock = blocks.find((b: string) => b.includes("event: done"));
    expect(doneBlock).toBeDefined();

    const dataLine = doneBlock!.split("\n").find((l: string) => l.startsWith("data: "));
    const doneData = JSON.parse(dataLine!.slice(6));
    expect(doneData).toHaveProperty("response");
    expect(doneData).toHaveProperty("model");
  });

  it("enforces daily token limit", async () => {
    process.env.DAILY_TOKEN_LIMIT = "100";
    const { app } = buildServer();
    // Use persistent mock so scheduler tick doesn't consume the value
    const { getTodayTokenTotal } = await import("@ai-cofounder/db");
    (getTodayTokenTotal as ReturnType<typeof vi.fn>).mockResolvedValue(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello" },
    });
    await app.close();

    expect(res.statusCode).toBe(429);
    // Reset mock and env
    (getTodayTokenTotal as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    delete process.env.DAILY_TOKEN_LIMIT;
  });
});
