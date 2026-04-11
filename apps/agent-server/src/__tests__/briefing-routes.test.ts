import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "supersecret";
});

const mockListActiveGoals = vi.fn().mockResolvedValue([]);
const mockListRecentlyCompletedGoals = vi.fn().mockResolvedValue([]);
const mockCountTasksByStatus = vi.fn().mockResolvedValue({});
const mockGetUsageSummary = vi.fn().mockResolvedValue({
  totalCostUsd: 0,
  requestCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  byProvider: {},
  byModel: {},
  byAgent: {},
});
const mockListEnabledSchedules = vi.fn().mockResolvedValue([]);
const mockListRecentWorkSessions = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
  sanitizeToolResult: (text: string) => text,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  getPrimaryAdminUserId: vi.fn().mockResolvedValue("admin-uuid-1"),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) => mockListRecentlyCompletedGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  listEnabledSchedules: (...args: unknown[]) => mockListEnabledSchedules(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  // Required by transitive imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversation: vi.fn().mockResolvedValue(null),
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
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
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
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
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

vi.mock("@ai-cofounder/rag", () => ({
  ingestText: vi.fn().mockResolvedValue(undefined),
  needsReingestion: vi.fn().mockResolvedValue(false),
  shouldSkipFile: vi.fn().mockReturnValue(false),
  ingestFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-abc"),
  goalChannel: vi.fn().mockReturnValue("goal:test"),
  pingRedis: vi.fn().mockResolvedValue(true),
}));

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
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createLlmRegistry: () => new MockLlmRegistry(),
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
});

describe("Briefing routes", () => {
  describe("GET /api/briefing", () => {
    it("returns briefing without sending notifications", async () => {
      // Use persistent mocks so scheduler tick doesn't consume them
      mockListActiveGoals.mockResolvedValue([
        {
          id: "g-1",
          title: "Build API",
          priority: "high",
          taskCount: 4,
          completedTaskCount: 2,
          updatedAt: new Date(),
        },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValue([]);
      mockCountTasksByStatus.mockResolvedValue({ pending: 3, completed: 5 });
      mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 0.15, requestCount: 12 });
      mockListEnabledSchedules.mockResolvedValue([]);
      mockListRecentWorkSessions.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/briefing",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sent).toBe(false);
      // LLM narrative is used when llmRegistry is available (returns mock LLM text)
      expect(body.briefing).toBeDefined();
      expect(typeof body.briefing).toBe("string");
      expect(body.data).toBeDefined();
      expect(body.data.activeGoals).toHaveLength(1);
    });

    it("returns briefing with empty data", async () => {
      mockListActiveGoals.mockResolvedValue([]);
      mockListRecentlyCompletedGoals.mockResolvedValue([]);
      mockCountTasksByStatus.mockResolvedValue({});
      mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValue([]);
      mockListRecentWorkSessions.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/briefing",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sent).toBe(false);
      expect(body.briefing).toBeDefined();
      expect(body.data.activeGoals).toHaveLength(0);
    });

    it("sends briefing when send=true", async () => {
      mockListActiveGoals.mockResolvedValue([]);
      mockListRecentlyCompletedGoals.mockResolvedValue([]);
      mockCountTasksByStatus.mockResolvedValue({});
      mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValue([]);
      mockListRecentWorkSessions.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/briefing?send=true",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sent).toBe(true);
      expect(typeof body.briefing).toBe("string");
      expect(body.briefing.length).toBeGreaterThan(0);
    });

    it("includes cost data in briefing data", async () => {
      mockListActiveGoals.mockResolvedValue([]);
      mockListRecentlyCompletedGoals.mockResolvedValue([]);
      mockCountTasksByStatus.mockResolvedValue({});
      mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 2.5, requestCount: 42 });
      mockListEnabledSchedules.mockResolvedValue([]);
      mockListRecentWorkSessions.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/briefing",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.costsSinceYesterday.totalCostUsd).toBe(2.5);
      expect(body.data.costsSinceYesterday.requestCount).toBe(42);
    });

    it("includes completed yesterday in briefing data", async () => {
      mockListActiveGoals.mockResolvedValue([]);
      mockListRecentlyCompletedGoals.mockResolvedValue([
        { title: "Deploy v1.0" },
        { title: "Fix auth bug" },
      ]);
      mockCountTasksByStatus.mockResolvedValue({});
      mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValue([]);
      mockListRecentWorkSessions.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/briefing",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.completedYesterday).toHaveLength(2);
      expect(body.data.completedYesterday[0].title).toBe("Deploy v1.0");
      expect(body.data.completedYesterday[1].title).toBe("Fix auth bug");
    });
  });
});
