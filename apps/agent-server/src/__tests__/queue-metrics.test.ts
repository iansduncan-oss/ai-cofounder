import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.REDIS_URL = "redis://localhost:6379";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
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
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
}));

const mockGetAllQueueStatus = vi.fn().mockResolvedValue([
  { name: "agent-tasks", waiting: 5, active: 2, failed: 0 },
  { name: "monitoring", waiting: 1, active: 0, failed: 0 },
  { name: "dead-letter", waiting: 3, active: 0, failed: 1 },
]);

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-mock"),
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
  pingRedis: vi.fn().mockResolvedValue("ok"),
  getAllQueueStatus: (...args: unknown[]) => mockGetAllQueueStatus(...args),
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

const internalHeaders = { "x-forwarded-for": "10.0.0.1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllQueueStatus.mockResolvedValue([
    { name: "agent-tasks", waiting: 5, active: 2, failed: 0 },
    { name: "monitoring", waiting: 1, active: 0, failed: 0 },
    { name: "dead-letter", waiting: 3, active: 0, failed: 1 },
  ]);
});

describe("Queue Prometheus metrics", () => {
  it("queue_depth and queue_active_jobs gauges appear in /metrics after collection", async () => {
    const { app } = buildServer();

    // Wait for onReady hook to fire and updateQueueMetrics to resolve
    await app.ready();
    await new Promise((r) => setTimeout(r, 50));

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.payload;
    expect(body).toContain("queue_depth");
    expect(body).toContain('queue="agent-tasks"');
    expect(body).toContain("queue_active_jobs");
  });

  it("dlq_size_total metric sums waiting + failed for dead-letter queue", async () => {
    const { app } = buildServer();

    await app.ready();
    await new Promise((r) => setTimeout(r, 50));

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.payload;
    expect(body).toContain("dlq_size_total");
    // dead-letter: waiting=3 + failed=1 = 4
    expect(body).toContain("dlq_size_total 4");
  });
});
