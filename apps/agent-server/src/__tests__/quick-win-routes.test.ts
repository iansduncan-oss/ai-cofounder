import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  // NOTE: JWT_SECRET and COOKIE_SECRET intentionally NOT set here.
  // Without JWT_SECRET, authPlugin no-ops and jwtGuardPlugin allows all requests through.
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

const mockGetConversation = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockListGoalsByConversation = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  listGoalsByConversation: (...args: unknown[]) => mockListGoalsByConversation(...args),
  // Required by transitive imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
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
    totalCostUsd: 0,
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byProvider: {},
    byModel: {},
    byAgent: {},
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
  goalChannel: vi.fn().mockReturnValue("goal:test"),
  pingRedis: vi.fn().mockResolvedValue(false),
}));

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agents/roles -- QWIN-03", () => {
  it("returns array of agent roles", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/agents/roles" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each role should have role and description properties
    expect(body[0]).toHaveProperty("role");
    expect(body[0]).toHaveProperty("description");
    // Should include orchestrator and researcher
    expect(body.some((r: { role: string }) => r.role === "orchestrator")).toBe(true);
    expect(body.some((r: { role: string }) => r.role === "researcher")).toBe(true);
    // Should have at least 5 roles (orchestrator + 6 specialists = 7 total)
    expect(body.length).toBeGreaterThanOrEqual(5);
  });
});

describe("GET /api/conversations/:id/export -- QWIN-04", () => {
  it("returns conversation as downloadable JSON", async () => {
    const convId = "00000000-0000-0000-0000-000000000001";
    mockGetConversation.mockResolvedValueOnce({ id: convId, title: "Test" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", content: "hi", createdAt: new Date() },
    ]);
    mockListGoalsByConversation.mockResolvedValueOnce([]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/export`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body);
    expect(body.conversation.id).toBe(convId);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.exportedAt).toBeDefined();
  });

  it("returns 404 for non-existent conversation", async () => {
    const convId = "00000000-0000-0000-0000-000000000002";
    mockGetConversation.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/export`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe("Swagger UI and OpenAPI spec -- QWIN-05, QWIN-06", () => {
  it("GET /docs/json returns OpenAPI spec", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it("GET /docs serves Swagger UI", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/docs" });
    await app.close();

    // Swagger UI may redirect to /docs/ or return 200 directly
    expect([200, 301, 302]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // HTML response should be Swagger UI
      expect(res.headers["content-type"]).toContain("text/html");
    }
  });
});
