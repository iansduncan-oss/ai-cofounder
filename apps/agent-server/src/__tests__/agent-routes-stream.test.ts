import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  getConversationMessageCount: vi.fn().mockResolvedValue(0),
  getLatestConversationSummary: vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn(),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  recordLlmUsage: vi.fn().mockResolvedValue({}),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  saveMemory: vi.fn().mockResolvedValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
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
  incrementPatternAcceptCount: vi.fn(),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}));

// Mock orchestrator to capture the AbortSignal
const mockRunStream = vi.fn();
const mockRun = vi.fn().mockResolvedValue({
  conversationId: "c-1",
  agentRole: "orchestrator",
  response: "ok",
  model: "test",
  provider: "test",
});

vi.mock("../agents/orchestrator.js", () => ({
  Orchestrator: class {
    runStream = mockRunStream;
    run = mockRun;
  },
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn();
    completeDirect = vi.fn();
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

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockRunStream.mockImplementation(
    async (_msg: string, onEvent: (e: { type: string; data: unknown }) => Promise<void>) => {
      await onEvent({ type: "thinking", data: { round: 0, message: "Loading..." } });
      await onEvent({
        type: "done",
        data: { response: "ok", model: "test", provider: "test", usage: { inputTokens: 1, outputTokens: 1 } },
      });
      return { conversationId: "c-1", agentRole: "orchestrator", response: "ok", model: "test", provider: "test" };
    },
  );
});

describe("SSE client disconnect — POST /api/agents/run/stream", { timeout: 15_000 }, () => {
  it("passes AbortSignal to orchestrator.runStream as 7th parameter", async () => {
    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    expect(mockRunStream).toHaveBeenCalledOnce();
    const args = mockRunStream.mock.calls[0];
    // runStream(message, onEvent, convId, history, userId, requestId, signal)
    expect(args[6]).toBeInstanceOf(AbortSignal);
  });

  it("emits exactly one error event when orchestrator throws (no duplicate from route handler)", async () => {
    mockRunStream.mockImplementation(
      async (_msg: string, onEvent: (e: { type: string; data: unknown }) => Promise<void>) => {
        await onEvent({ type: "thinking", data: { round: 0, message: "..." } });
        // Orchestrator's catch block emits error event then re-throws
        await onEvent({ type: "error", data: { error: "LLM failed" } });
        throw new Error("LLM failed");
      },
    );

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);

    const blocks = res.body.split("\n\n").filter(Boolean);
    const errorBlocks = blocks.filter((b: string) => b.includes("event: error"));
    // Only 1 error event from orchestrator — route handler no longer emits a duplicate
    expect(errorBlocks).toHaveLength(1);
  });

  it("stream ends cleanly via finally block even when orchestrator throws", async () => {
    mockRunStream.mockRejectedValue(new Error("Unexpected failure"));

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    // Response still completes (200 because SSE headers were already sent)
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
  });
});
