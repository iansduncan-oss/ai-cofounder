import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

const mockOptionalEnv = vi.fn((_name: string, defaultValue: string) => defaultValue);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (...args: unknown[]) => mockOptionalEnv(...(args as [string, string])),
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

const mockDbExecute = vi.fn().mockResolvedValue([{ "?column?": 1 }]);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: (...args: unknown[]) => mockDbExecute(...args),
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
  updateGoalStatus: vi.fn(),
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

const mockPingRedis = vi.fn().mockResolvedValue("ok");

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
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
  pingRedis: (...args: unknown[]) => mockPingRedis(...args),
  getAllQueueStatus: vi.fn().mockResolvedValue([]),
}));

// Mock ioredis to prevent real Redis connections (CI self-heal, pubsub)
vi.mock("ioredis", () => {
  class MockRedis {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue(undefined);
    subscribe = vi.fn().mockResolvedValue(undefined);
    unsubscribe = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(0);
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue("OK");
    del = vi.fn().mockResolvedValue(1);
    status = "ready";
  }
  return { default: MockRedis };
});

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
    getCircuitBreakerStates = vi.fn().mockReturnValue([]);
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

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockOptionalEnv.mockImplementation((name: string, defaultValue: string) => {
    if (name === "REDIS_URL") return "redis://localhost:6379";
    return defaultValue;
  });
  mockDbExecute.mockResolvedValue([{ "?column?": 1 }]);
  mockPingRedis.mockResolvedValue("ok");
});

/* ──────────────────── Deep Health Check Tests ──────────────────── */

describe("GET /health/deep", () => {
  it("returns 200 with all checks ok", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toHaveLength(3);
    expect(body.checks.map((c: { name: string }) => c.name)).toEqual(["database", "redis", "llm"]);
  });

  it("each check has numeric latencyMs >= 0", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    const body = res.json();
    for (const check of body.checks) {
      expect(typeof check.latencyMs).toBe("number");
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns 503 when DB unreachable", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("Connection refused"));

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    const dbCheck = body.checks.find((c: { name: string }) => c.name === "database");
    expect(dbCheck.status).toBe("unreachable");
    expect(dbCheck.error).toBeDefined();
  });

  it("returns 503 when Redis unreachable", async () => {
    mockPingRedis.mockResolvedValueOnce("unreachable");

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    const redisCheck = body.checks.find((c: { name: string }) => c.name === "redis");
    expect(redisCheck.status).toBe("unreachable");
  });

  it("Redis reported as disabled when REDIS_URL empty", async () => {
    mockOptionalEnv.mockImplementation((_name: string, defaultValue: string) => defaultValue);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const redisCheck = body.checks.find((c: { name: string }) => c.name === "redis");
    expect(redisCheck.status).toBe("disabled");
  });

  it("LLM reported as disabled when no providers", async () => {
    const { app } = buildServer();
    // Default mock returns [] for getProviderHealth
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    const body = res.json();
    const llmCheck = body.checks.find((c: { name: string }) => c.name === "llm");
    expect(llmCheck.status).toBe("disabled");
  });

  it("LLM reported as degraded when some providers unavailable", async () => {
    const { app } = buildServer();
    app.llmRegistry.getProviderHealth = vi.fn().mockReturnValue([
      { name: "anthropic", available: true },
      { name: "groq", available: false },
    ]);

    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    const llmCheck = body.checks.find((c: { name: string }) => c.name === "llm");
    expect(llmCheck.status).toBe("degraded");
  });

  it("response has correct top-level fields", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/deep" });
    await app.close();

    const body = res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
    expect(body).toHaveProperty("totalLatencyMs");
    expect(body).toHaveProperty("checks");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.totalLatencyMs).toBe("number");
    expect(typeof body.timestamp).toBe("string");
    expect(Array.isArray(body.checks)).toBe(true);
  });
});
