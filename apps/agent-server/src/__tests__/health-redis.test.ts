import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

// --- Mock @ai-cofounder/shared ---
// We need to control optionalEnv per test to simulate REDIS_URL set/unset
const mockOptionalEnv = vi.fn((_name: string, defaultValue: string) => defaultValue);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (...args: unknown[]) => mockOptionalEnv(...(args as [string, string])),
  requireEnv: (name: string) => {
    const vals: Record<string, string> = {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    };
    if (vals[name]) return vals[name];
    throw new Error(`Missing required env: ${name}`);
  },
}));

// --- Mock @ai-cofounder/db ---
const mockDbExecute = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
const mockCreateDb = vi.fn().mockReturnValue({
  execute: (...args: unknown[]) => mockDbExecute(...args),
});

vi.mock("@ai-cofounder/db", () => new Proxy({
  createDb: (...args: unknown[]) => mockCreateDb(...args),
  // All DB fns needed for server bootstrap
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn().mockResolvedValue({}),
  updateGoalMetadata: vi.fn().mockResolvedValue({}),
  getGoal: vi.fn(),
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
  saveMemory: vi.fn().mockResolvedValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
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

// --- Mock @ai-cofounder/queue ---
const mockPingRedis = vi.fn().mockResolvedValue("ok");

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-123"),
  getJobStatus: vi.fn().mockResolvedValue(null),
  pingRedis: (...args: unknown[]) => mockPingRedis(...args),
  // pubsub exports required by pubsubPlugin
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
}));

// --- Mock @ai-cofounder/llm ---
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: REDIS_URL is set
  mockOptionalEnv.mockImplementation((name: string, defaultValue: string) => {
    if (name === "REDIS_URL") return "redis://localhost:6379";
    return defaultValue;
  });
  // Default: DB is healthy
  mockDbExecute.mockResolvedValue([{ "?column?": 1 }]);
  // Default: Redis is ok
  mockPingRedis.mockResolvedValue("ok");
});

/* ──────────────────── Health Redis Tests ──────────────────── */

describe("QUEUE-08: GET /health includes redis: ok when Redis is reachable", () => {
  it("returns redis=ok and status=ok when Redis pings successfully", async () => {
    mockPingRedis.mockResolvedValueOnce("ok");

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.redis).toBe("ok");
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
  });
});

describe("QUEUE-08: GET /health reports degraded when Redis unreachable", () => {
  it("returns status=degraded (503) when Redis is unreachable", async () => {
    mockPingRedis.mockResolvedValueOnce("unreachable");

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.redis).toBe("unreachable");
    expect(body.status).toBe("degraded");
  });
});

describe("QUEUE-08: GET /health reports redis: disabled when REDIS_URL not set", () => {
  it("returns redis=disabled and status=ok when REDIS_URL is empty", async () => {
    // Simulate REDIS_URL not set (optionalEnv returns "" for REDIS_URL)
    mockOptionalEnv.mockImplementation((name: string, defaultValue: string) => {
      if (name === "REDIS_URL") return "";
      return defaultValue;
    });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.redis).toBe("disabled");
    expect(body.status).toBe("ok");
    expect(mockPingRedis).not.toHaveBeenCalled();
  });
});

describe("QUEUE-08: GET /health still reports database status", () => {
  it("returns database=unreachable and status=degraded when DB fails", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("DB connection failed"));

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.database).toBe("unreachable");
    expect(body.status).toBe("degraded");
  });
});

describe("QUEUE-08: GET /health returns both database and redis fields", () => {
  it("response object has both database and redis keys", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    const body = res.json();
    expect(body).toHaveProperty("database");
    expect(body).toHaveProperty("redis");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
  });
});
