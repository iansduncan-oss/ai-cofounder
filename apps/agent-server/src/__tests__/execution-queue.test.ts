import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

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
const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});
const mockCreateDb = vi.fn().mockReturnValue({
  execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: (...args: unknown[]) => mockCreateDb(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
  // Other db fns needed for server bootstrap
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn().mockResolvedValue({}),
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
}));

// --- Mock @ai-cofounder/queue ---
const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-123");

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
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

// --- Mock dispatcher and verification ---
vi.mock("../agents/dispatcher.js", () => ({
  TaskDispatcher: class {
    runGoal = vi.fn().mockResolvedValue({ status: "completed", tasks: [] });
    getProgress = vi.fn().mockResolvedValue({});
  },
}));

vi.mock("../services/verification.js", () => ({
  VerificationService: class {
    verify = vi.fn().mockResolvedValue({});
  },
}));

const { buildServer } = await import("../server.js");

const UUID = "00000000-0000-0000-0000-000000000001";
const headers = { "x-forwarded-for": "10.0.1.50" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueueAgentTask.mockResolvedValue("job-123");
  mockUpdateGoalMetadata.mockResolvedValue({});
});

/* ──────────────────── Execution Queue Tests ──────────────────── */

describe("QUEUE-02: POST /api/goals/:id/execute returns 202 with jobId", () => {
  it("returns 202 status with jobId, status=queued, and goalId", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      description: "Build the MVP",
      metadata: {},
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBe("job-123");
    expect(body.status).toBe("queued");
    expect(body.goalId).toBe(UUID);
  });
});

describe("QUEUE-02: enqueueAgentTask called with correct args", () => {
  it("calls enqueueAgentTask with goalId, prompt from goal description, and userId", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      description: "Build the minimum viable product",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(mockEnqueueAgentTask).toHaveBeenCalledWith({
      goalId: UUID,
      prompt: "Build the minimum viable product",
      userId: "u-1",
      priority: undefined,
    });
  });

  it("uses goal.title as prompt when description is absent", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      description: null,
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(mockEnqueueAgentTask).toHaveBeenCalledWith({
      goalId: UUID,
      prompt: "Build MVP",
      userId: "u-1",
      priority: undefined,
    });
  });
});

describe("QUEUE-02: queueJobId stored in goal metadata", () => {
  it("stores queueJobId in goal metadata via updateGoalMetadata", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      description: "Build the MVP",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(mockUpdateGoalMetadata).toHaveBeenCalledWith(
      expect.anything(), // db instance
      UUID,
      expect.objectContaining({ queueJobId: "job-123" }),
    );
  });

  it("stores webhookUrl in goal metadata when provided", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Build MVP",
      description: "Build the MVP",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1", webhookUrl: "https://discord.com/webhook/123" },
      headers,
    });
    await app.close();

    expect(mockUpdateGoalMetadata).toHaveBeenCalledWith(
      expect.anything(),
      UUID,
      expect.objectContaining({
        queueJobId: "job-123",
        webhookUrl: "https://discord.com/webhook/123",
      }),
    );
  });
});

describe("QUEUE-02: 404 when goal not found", () => {
  it("returns 404 when goal does not exist", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(mockEnqueueAgentTask).not.toHaveBeenCalled();
  });
});

describe("QUEUE-09: priority passed through to enqueueAgentTask", () => {
  it("passes critical priority to enqueueAgentTask", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Urgent Goal",
      description: "Do this urgently",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1", priority: "critical" },
      headers,
    });
    await app.close();

    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "critical" }),
    );
  });

  it("passes low priority to enqueueAgentTask", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: UUID,
      title: "Low Priority Goal",
      description: "Do this when you can",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${UUID}/execute`,
      payload: { userId: "u-1", priority: "low" },
      headers,
    });
    await app.close();

    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "low" }),
    );
  });
});
