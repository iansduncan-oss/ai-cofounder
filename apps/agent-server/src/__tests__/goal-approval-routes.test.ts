import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
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

const mockGetGoal = vi.fn();
const mockUpdateGoalStatus = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]) }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  updateGoalMetadata: vi.fn(),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
  findAdminByEmail: vi.fn().mockResolvedValue(undefined),
  countAdminUsers: vi.fn().mockResolvedValue(0),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} }),
  countEvents: vi.fn().mockResolvedValue(0),
  listEvents: vi.fn().mockResolvedValue([]),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  getConversation: vi.fn(),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  getConversationMessageCount: vi.fn().mockResolvedValue(0),
  getLatestConversationSummary: vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn(),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  recordLlmUsage: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  getChunkCount: vi.fn().mockResolvedValue(0),
  listIngestionStates: vi.fn().mockResolvedValue([]),
  listReflections: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getReflectionStats: vi.fn().mockResolvedValue([]),
  getMilestone: vi.fn().mockResolvedValue(null),
  listMilestones: vi.fn().mockResolvedValue([]),
  getPersona: vi.fn().mockResolvedValue(null),
  listPersonas: vi.fn().mockResolvedValue([]),
  goals: {},
  runMigrations: vi.fn(),
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
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {},
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
let app: ReturnType<typeof buildServer>["app"];

beforeAll(async () => {
  const server = buildServer();
  app = server.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const GOAL_UUID = "00000000-0000-0000-0000-000000000001";

describe("POST /api/goals/:id/approve", () => {
  it("approves a proposed goal → 200 + active", async () => {
    mockGetGoal.mockResolvedValue({ id: GOAL_UUID, status: "proposed", title: "Test" });
    mockUpdateGoalStatus.mockResolvedValue({ id: GOAL_UUID, status: "active" });

    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/approve` });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), GOAL_UUID, "active");
  });

  it("returns 404 for missing goal", async () => {
    mockGetGoal.mockResolvedValue(null);
    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/approve` });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 for non-proposed goal", async () => {
    mockGetGoal.mockResolvedValue({ id: GOAL_UUID, status: "active", title: "Test" });
    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/approve` });
    expect(res.statusCode).toBe(409);
  });
});

describe("POST /api/goals/:id/reject", () => {
  it("rejects a proposed goal → 200 + cancelled", async () => {
    mockGetGoal.mockResolvedValue({ id: GOAL_UUID, status: "proposed", title: "Test" });
    mockUpdateGoalStatus.mockResolvedValue({ id: GOAL_UUID, status: "cancelled" });

    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/reject`, payload: { reason: "Not needed" } });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith(expect.anything(), GOAL_UUID, "cancelled");
  });

  it("returns 409 for non-proposed goal", async () => {
    mockGetGoal.mockResolvedValue({ id: GOAL_UUID, status: "completed", title: "Test" });
    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/reject` });
    expect(res.statusCode).toBe(409);
  });
});

describe("POST /api/goals/:id/execute — proposed guard", () => {
  it("returns 409 for proposed goals", async () => {
    mockGetGoal.mockResolvedValue({ id: GOAL_UUID, status: "proposed", title: "Test" });
    const res = await app.inject({ method: "POST", url: `/api/goals/${GOAL_UUID}/execute`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("proposed");
  });
});
