import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// --- Mocked DB functions ---
const mockGetGoal = vi.fn();
const mockCreateGoal = vi.fn();
const mockListTasksByGoal = vi.fn();
const mockAssignTask = vi.fn();
const mockStartTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn();
const mockUpdateGoalStatus = vi.fn();
const mockListPendingApprovalsForTasks = vi.fn().mockResolvedValue([]);
const mockRecordLlmUsage = vi.fn().mockResolvedValue({ id: "usage-1" });
const mockGetUsageSummary = vi.fn().mockResolvedValue({
  totalInputTokens: 100,
  totalOutputTokens: 200,
  totalCostUsd: 0.001,
  byProvider: { anthropic: { inputTokens: 100, outputTokens: 200, costUsd: 0.001, requests: 1 } },
  byModel: {},
  byAgent: {},
  requestCount: 1,
});

const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn(),
  getGoal: mockGetGoal,
  createGoal: mockCreateGoal,
  createTask: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: mockUpdateGoalStatus,
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
  getTask: vi.fn(),
  listTasksByGoal: mockListTasksByGoal,
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: mockAssignTask,
  startTask: mockStartTask,
  completeTask: mockCompleteTask,
  failTask: mockFailTask,
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovalsForTasks: mockListPendingApprovalsForTasks,
  listApprovalsByTask: vi.fn().mockResolvedValue([]),
  resolveApproval: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
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
  recordLlmUsage: mockRecordLlmUsage,
  getUsageSummary: mockGetUsageSummary,
  saveCodeExecution: vi.fn(),
  listCodeExecutionsByTask: vi.fn().mockResolvedValue([]),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
}));

// Mock @ai-cofounder/queue — execution route uses enqueueAgentTask
const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-e2e-123");

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Task output from agent" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 100 },
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
    seedStats = vi.fn();
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    onCompletion: unknown = undefined;
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

const GOAL_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockListPendingApprovalsForTasks.mockResolvedValue([]);
});

describe("E2E goal execution flow — queue-backed", () => {
  // NOTE: Since Phase 1, POST /:id/execute enqueues to BullMQ and returns 202 immediately.
  // The worker process (worker.ts) picks up and runs the job asynchronously.
  // These E2E tests verify the non-blocking HTTP behavior.

  it("enqueues goal execution and returns 202 with jobId", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: GOAL_ID,
      title: "Build Feature",
      description: "Build the feature",
      status: "active",
      metadata: {},
    });
    mockEnqueueAgentTask.mockResolvedValueOnce("job-e2e-123");

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBe("job-e2e-123");
    expect(body.status).toBe("queued");
    expect(body.goalId).toBe(GOAL_ID);

    // Verify enqueue was called with correct args
    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: GOAL_ID }),
    );

    // Verify jobId stored in metadata for later status lookup
    expect(mockUpdateGoalMetadata).toHaveBeenCalledWith(
      expect.anything(),
      GOAL_ID,
      expect.objectContaining({ queueJobId: "job-e2e-123" }),
    );
  });

  it("returns 404 when goal not found", async () => {
    mockGetGoal.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: {},
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(mockEnqueueAgentTask).not.toHaveBeenCalled();
  });

  it("passes userId and priority to enqueueAgentTask", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: GOAL_ID,
      title: "Urgent Goal",
      description: "Do this ASAP",
      status: "active",
      metadata: {},
    });

    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: { userId: "user-123", priority: "high" },
    });
    await app.close();

    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-123", priority: "high" }),
    );
  });
});

describe("Usage API", () => {
  it("GET /api/usage returns usage summary", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/usage?period=today" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe("today");
    expect(body.totalInputTokens).toBe(100);
    expect(body.totalCostUsd).toBe(0.001);
    expect(body.requestCount).toBe(1);
  });

  it("GET /api/usage supports different periods", async () => {
    const { app } = buildServer();

    for (const period of ["today", "week", "month", "all"]) {
      const res = await app.inject({ method: "GET", url: `/api/usage?period=${period}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().period).toBe(period);
    }

    await app.close();
  });
});

describe("Provider health endpoint", () => {
  it("GET /health/providers returns provider health", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/health/providers" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBeDefined();
    expect(body.providers).toBeDefined();
  });
});
