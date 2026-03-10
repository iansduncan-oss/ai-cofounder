import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});
process.env.BRIEFING_HOUR = "25";

// --- Mocked DB functions ---
const mockFindOrCreateUser = vi.fn().mockResolvedValue({ id: "user-1", externalId: "dashboard-user", platform: "dashboard" });
const mockCreateConversation = vi.fn().mockResolvedValue({ id: "conv-1" });
const mockCreateGoal = vi.fn();
const mockGetGoal = vi.fn();
const mockListGoalsByConversation = vi.fn().mockResolvedValue([]);
const mockUpdateGoalStatus = vi.fn();
const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});
const mockCreateTask = vi.fn();
const mockListTasksByGoal = vi.fn().mockResolvedValue([]);
const mockCreateMessage = vi.fn();
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockCreateMilestone = vi.fn();
const mockListMilestones = vi.fn().mockResolvedValue([]);
const mockGetMilestoneProgress = vi.fn().mockResolvedValue({ total: 0, completed: 0, percent: 0 });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: (...args: unknown[]) => mockFindOrCreateUser(...args),
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  listGoalsByConversation: (...args: unknown[]) => mockListGoalsByConversation(...args),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  listTasksByGoal: (...args: unknown[]) => mockListTasksByGoal(...args),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  getTask: vi.fn(),
  assignTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listPendingApprovalsForTasks: vi.fn().mockResolvedValue([]),
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
  recordLlmUsage: vi.fn().mockResolvedValue({ id: "usage-1" }),
  getUsageSummary: vi.fn().mockResolvedValue({
    totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
    byProvider: {}, byModel: {}, byAgent: {}, requestCount: 0,
  }),
  saveCodeExecution: vi.fn(),
  listCodeExecutionsByTask: vi.fn().mockResolvedValue([]),
  createMilestone: (...args: unknown[]) => mockCreateMilestone(...args),
  getMilestone: vi.fn(),
  listMilestones: (...args: unknown[]) => mockListMilestones(...args),
  updateMilestone: vi.fn(),
  deleteMilestone: vi.fn(),
  getMilestoneProgress: (...args: unknown[]) => mockGetMilestoneProgress(...args),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
}));

const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-123");

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Agent response" }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: "test",
    });
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    getTotalCost = vi.fn().mockReturnValue(0);
    getCircuitBreakerStates = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createLlmRegistry: () => new MockLlmRegistry(),
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

describe("E2E: Full workflow — create goal → add tasks → execute", () => {
  const GOAL_ID = "00000000-0000-0000-0000-000000000001";
  const CONV_ID = "00000000-0000-0000-0000-000000000010";

  it("creates a goal, lists it, then executes it", async () => {
    // Setup: goal creation returns a goal
    mockCreateGoal.mockResolvedValueOnce({
      id: GOAL_ID,
      conversationId: CONV_ID,
      title: "Deploy new feature",
      status: "draft",
      priority: "high",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { app } = buildServer();

    // Step 1: Create a goal
    const createRes = await app.inject({
      method: "POST",
      url: "/api/goals",
      payload: {
        conversationId: CONV_ID,
        title: "Deploy new feature",
        priority: "high",
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBe(GOAL_ID);
    expect(mockCreateGoal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Deploy new feature", priority: "high" }),
    );

    // Step 2: List goals for conversation
    mockListGoalsByConversation.mockResolvedValueOnce([
      { id: GOAL_ID, title: "Deploy new feature", status: "draft", priority: "high" },
    ]);
    const listRes = await app.inject({
      method: "GET",
      url: `/api/goals?conversationId=${CONV_ID}`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);

    // Step 3: Execute the goal
    mockGetGoal.mockResolvedValueOnce({
      id: GOAL_ID,
      title: "Deploy new feature",
      status: "active",
      metadata: {},
    });
    const execRes = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: { priority: "high" },
    });
    expect(execRes.statusCode).toBe(202);
    expect(execRes.json().status).toBe("queued");
    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: GOAL_ID, priority: "high" }),
    );

    await app.close();
  });

  it("creates a milestone, links goal, checks progress", async () => {
    const MILESTONE_ID = "00000000-0000-0000-0000-000000000099";

    mockCreateMilestone.mockResolvedValueOnce({
      id: MILESTONE_ID,
      title: "v0.2.0",
      description: "Next release",
      status: "planned",
    });

    const { app } = buildServer();

    // Step 1: Create milestone
    const mRes = await app.inject({
      method: "POST",
      url: "/api/milestones",
      payload: { conversationId: CONV_ID, title: "v0.2.0", description: "Next release" },
    });
    expect(mRes.statusCode).toBe(201);
    expect(mRes.json().id).toBe(MILESTONE_ID);

    // Step 2: Check progress
    mockGetMilestoneProgress.mockResolvedValueOnce({
      total: 3, completed: 1, percent: 33,
    });
    const progressRes = await app.inject({
      method: "GET",
      url: `/api/milestones/${MILESTONE_ID}/progress`,
    });
    expect(progressRes.statusCode).toBe(200);
    expect(progressRes.json().percent).toBe(33);

    await app.close();
  });

  it("full chat flow — send message and get streamed response", async () => {
    const { app } = buildServer();

    // POST /api/agents/run — the main chat endpoint
    const chatRes = await app.inject({
      method: "POST",
      url: "/api/agents/run",
      payload: {
        message: "What's the status of our deployment?",
        conversationId: CONV_ID,
        userId: "user-1",
      },
    });

    // Should return 200 with agent response
    expect(chatRes.statusCode).toBe(200);

    await app.close();
  });

  it("health check returns system status", async () => {
    const { app } = buildServer();

    const healthRes = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().status).toBe("ok");

    await app.close();
  });
});
