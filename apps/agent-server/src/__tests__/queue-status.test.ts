import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

// --- Mock @ai-cofounder/shared ---
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => {
    const vals: Record<string, string> = {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    };
    if (vals[name]) return vals[name];
    throw new Error(`Missing required env: ${name}`);
  },
}));

// --- Mock @ai-cofounder/db ---
const mockGetGoal = vi.fn();
const mockCreateDb = vi.fn().mockReturnValue({
  execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
});

vi.mock("@ai-cofounder/db", () => new Proxy({
  createDb: (...args: unknown[]) => mockCreateDb(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  // Other db fns needed for server bootstrap
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn().mockResolvedValue({}),
  updateGoalMetadata: vi.fn().mockResolvedValue({}),
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
const mockGetJobStatus = vi.fn();

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-123"),
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
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

const UUID = "00000000-0000-0000-0000-000000000001";
const headers = { "x-forwarded-for": "10.0.2.50" };

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────── Queue Status Endpoint Tests ──────────────────── */

describe("QUEUE-06: GET /api/goals/:id/queue-status — returns job state for queued goal", () => {
  it("returns status=active with jobId and attemptsMade when job is active", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "active",
      metadata: { queueJobId: "job-1" },
    });
    mockGetJobStatus.mockResolvedValueOnce({
      state: "active",
      jobId: "job-1",
      attemptsMade: 0,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.jobId).toBe("job-1");
    expect(body.attemptsMade).toBe(0);
  });
});

describe("QUEUE-06: GET /api/goals/:id/queue-status — returns not_queued when no jobId", () => {
  it("returns status=not_queued when goal has no queueJobId in metadata", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "draft",
      metadata: {},
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("not_queued");
    expect(mockGetJobStatus).not.toHaveBeenCalled();
  });

  it("returns status=not_queued when goal has null metadata", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "draft",
      metadata: null,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("not_queued");
  });
});

describe("QUEUE-06: GET /api/goals/:id/queue-status — returns not_found when job expired from Redis", () => {
  it("returns status=not_found when getJobStatus returns null", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "completed",
      metadata: { queueJobId: "expired-job" },
    });
    mockGetJobStatus.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("not_found");
    expect(body.jobId).toBe("expired-job");
  });
});

describe("QUEUE-06: GET /api/goals/:id/queue-status — 404 when goal not found", () => {
  it("returns 404 when goal does not exist", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Goal not found");
    expect(mockGetJobStatus).not.toHaveBeenCalled();
  });
});

describe("QUEUE-06: GET /api/goals/:id/queue-status — returns completed state with finishedOn", () => {
  it("returns finishedOn timestamp when job is completed", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "completed",
      metadata: { queueJobId: "job-1" },
    });
    mockGetJobStatus.mockResolvedValueOnce({
      state: "completed",
      jobId: "job-1",
      attemptsMade: 1,
      finishedOn: 1234567890,
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.finishedOn).toBe(1234567890);
    expect(body.attemptsMade).toBe(1);
  });
});

describe("QUEUE-06: GET /api/goals/:id/queue-status — returns failed state with failedReason", () => {
  it("returns failedReason when job has failed", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      status: "failed",
      metadata: { queueJobId: "job-1" },
    });
    mockGetJobStatus.mockResolvedValueOnce({
      state: "failed",
      jobId: "job-1",
      attemptsMade: 3,
      failedReason: "LLM timeout",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${UUID}/queue-status`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("failed");
    expect(body.failedReason).toBe("LLM timeout");
    expect(body.attemptsMade).toBe(3);
  });
});
