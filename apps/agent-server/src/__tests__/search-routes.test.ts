import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mockSharedModule, mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => mockSharedModule());

const mockGlobalSearch = vi.fn().mockResolvedValue({
  goals: [],
  tasks: [],
  conversations: [],
  memories: [],
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  globalSearch: (...args: unknown[]) => mockGlobalSearch(...args),
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
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry, AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {},
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/queue", () => ({
  RedisPubSub: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(),
    publish: vi.fn(),
    close: vi.fn(),
  })),
  setupRecurringJobs: vi.fn(),
  getMonitoringQueue: vi.fn().mockReturnValue({ add: vi.fn(), upsertJobScheduler: vi.fn() }),
  getNotificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getAgentTaskQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getBriefingQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getPipelineQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getRagIngestionQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getReflectionQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getSubagentTaskQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getDeployVerificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getDeadLetterQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getMeetingPrepQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  closeAllQueues: vi.fn(),
  listDeadLetterJobs: vi.fn().mockResolvedValue([]),
  enqueueRagIngestion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  createSandboxService: vi.fn().mockReturnValue({ available: false }),
  hashCode: vi.fn().mockReturnValue("hash"),
}));

const { buildServer } = await import("../server.js");

let app: Awaited<ReturnType<typeof buildServer>>["app"];

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  if (app) await app.close();
});

describe("Search Routes", () => {
  beforeEach(async () => {
    if (!app) {
      const server = await buildServer();
      app = server.app;
      await app.ready();
    }
  });

  it("GET /api/search?q=test returns categorized results", async () => {
    mockGlobalSearch.mockResolvedValueOnce({
      goals: [{ id: "g-1", title: "Test Goal", status: "active", createdAt: new Date().toISOString() }],
      tasks: [{ id: "t-1", title: "Test Task", status: "pending", goalId: "g-1", createdAt: new Date().toISOString() }],
      conversations: [],
      memories: [],
    });

    const res = await app.inject({ method: "GET", url: "/api/search?q=test" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.goals).toHaveLength(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.conversations).toEqual([]);
    expect(body.memories).toEqual([]);
    expect(mockGlobalSearch).toHaveBeenCalledWith(expect.anything(), "test");
  });

  it("rejects query shorter than 2 characters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=a" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing query parameter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search" });
    expect(res.statusCode).toBe(400);
  });
});
