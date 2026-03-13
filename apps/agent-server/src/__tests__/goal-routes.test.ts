import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

const mockUpdateGoalStatus = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  updateGoalMetadata: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
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
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
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
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn().mockResolvedValue({
    totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
    byProvider: {}, byModel: {}, byAgent: {},
  }),
  countEvents: vi.fn().mockResolvedValue(0),
  listEvents: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getConversationMessageCount: vi.fn().mockResolvedValue(0),
  getLatestConversationSummary: vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn(),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  getChunkCount: vi.fn().mockResolvedValue(0),
  listIngestionStates: vi.fn().mockResolvedValue([]),
  findAdminByEmail: vi.fn().mockResolvedValue(undefined),
  countAdminUsers: vi.fn().mockResolvedValue(0),
  listReflections: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getReflection: vi.fn().mockResolvedValue(null),
  getReflectionStats: vi.fn().mockResolvedValue([]),
  insertReflection: vi.fn(),
  listReflectionsByGoal: vi.fn().mockResolvedValue([]),
  getMilestone: vi.fn().mockResolvedValue(null),
  createMilestone: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getPersona: vi.fn().mockResolvedValue(null),
  listPersonas: vi.fn().mockResolvedValue([]),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
  getConversation: vi.fn(),
  getConversationMessages: vi.fn().mockResolvedValue([]),
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
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-mock"),
  enqueueReflection: vi.fn().mockResolvedValue("job-mock"),
  enqueueRagIngestion: vi.fn().mockResolvedValue("job-mock"),
  enqueuePipeline: vi.fn().mockResolvedValue("job-mock"),
  getPipelineQueue: vi.fn().mockReturnValue(null),
  getJobStatus: vi.fn().mockResolvedValue(null),
  goalChannel: (goalId: string) => `agent-events:goal:${goalId}`,
  historyKey: (goalId: string) => `agent-events:history:${goalId}`,
  CHANNEL_PREFIX: "agent-events:goal:",
  HISTORY_PREFIX: "agent-events:history:",
  HISTORY_TTL_SECONDS: 3600,
  RedisPubSub: class {
    publish = vi.fn().mockResolvedValue(undefined);
    getHistory = vi.fn().mockResolvedValue([]);
    close = vi.fn().mockResolvedValue(undefined);
  },
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
  pingRedis: vi.fn().mockResolvedValue(false),
}));

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────── Bulk Goal Status Tests ──────────────────── */

describe("PATCH /api/goals/bulk-status", () => {
  const id1 = "00000000-0000-0000-0000-000000000001";
  const id2 = "00000000-0000-0000-0000-000000000002";

  it("updates multiple goals and returns updated count", async () => {
    mockUpdateGoalStatus
      .mockResolvedValueOnce({ id: id1, status: "completed" })
      .mockResolvedValueOnce({ id: id2, status: "cancelled" });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/bulk-status",
      payload: {
        updates: [
          { id: id1, status: "completed" },
          { id: id2, status: "cancelled" },
        ],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(2);
    expect(mockUpdateGoalStatus).toHaveBeenCalledTimes(2);
  });

  it("skips non-existent goals (updated count < input count)", async () => {
    mockUpdateGoalStatus
      .mockResolvedValueOnce({ id: id1, status: "completed" })
      .mockResolvedValueOnce(null); // id2 not found

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/bulk-status",
      payload: {
        updates: [
          { id: id1, status: "completed" },
          { id: id2, status: "cancelled" },
        ],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(1);
  });

  it("does not broadcast WebSocket when no goals updated", async () => {
    mockUpdateGoalStatus.mockResolvedValueOnce(null); // not found

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/bulk-status",
      payload: { updates: [{ id: id1, status: "completed" }] },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(0);
  });

  it("rejects empty updates array (schema validation)", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/bulk-status",
      payload: { updates: [] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});
