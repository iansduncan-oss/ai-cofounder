import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  // NOTE: JWT_SECRET and COOKIE_SECRET intentionally NOT set here.
  // Reflection route tests focus on business logic, not auth.
  // Without JWT_SECRET, authPlugin no-ops and jwtGuardPlugin allows all requests through.
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

const mockListReflections = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockGetReflection = vi.fn().mockResolvedValue(null);
const mockGetReflectionStats = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => new Proxy({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listReflections: (...args: unknown[]) => mockListReflections(...args),
  getReflection: (...args: unknown[]) => mockGetReflection(...args),
  getReflectionStats: (...args: unknown[]) => mockGetReflectionStats(...args),
  insertReflection: vi.fn(),
  listReflectionsByGoal: vi.fn().mockResolvedValue([]),
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
  listActiveGoals: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
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
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} }),
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

describe("Reflection routes", () => {
  describe("GET /api/reflections", () => {
    it("returns empty list by default", async () => {
      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/reflections" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("passes type filter to repository", async () => {
      mockListReflections.mockResolvedValue({ data: [], total: 0 });

      const { app } = buildServer();
      await app.inject({ method: "GET", url: "/api/reflections?type=weekly_summary" });
      await app.close();

      expect(mockListReflections).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: "weekly_summary" }),
      );
    });

    it("passes pagination params", async () => {
      const { app } = buildServer();
      await app.inject({ method: "GET", url: "/api/reflections?limit=10&offset=5" });
      await app.close();

      expect(mockListReflections).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe("GET /api/reflections/stats", () => {
    it("returns aggregate stats", async () => {
      mockGetReflectionStats.mockResolvedValue([
        { reflectionType: "goal_completion", count: 5, avgLessons: 3 },
        { reflectionType: "weekly_summary", count: 2, avgLessons: 5 },
      ]);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/reflections/stats" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stats).toHaveLength(2);
      expect(body.stats[0].count).toBe(5);
    });
  });

  describe("GET /api/reflections/:id", () => {
    it("returns 404 when not found", async () => {
      mockGetReflection.mockResolvedValue(null);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/reflections/nonexistent-id" });
      await app.close();

      expect(res.statusCode).toBe(404);
    });

    it("returns reflection when found", async () => {
      mockGetReflection.mockResolvedValue({
        id: "ref-1",
        reflectionType: "goal_completion",
        content: "Test reflection",
        lessons: [{ lesson: "Test", category: "technical", confidence: 0.9 }],
      });

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/reflections/ref-1" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("ref-1");
      expect(body.lessons).toHaveLength(1);
    });
  });

  describe("POST /api/reflections/weekly", () => {
    it("returns 503 when queue not enabled", async () => {
      const { app } = buildServer();
      const res = await app.inject({ method: "POST", url: "/api/reflections/weekly" });
      await app.close();

      expect(res.statusCode).toBe(503);
    });
  });
});
