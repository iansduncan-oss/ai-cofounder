import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockGetProviderHealthHistory = vi.fn().mockResolvedValue([
  {
    id: "ph-1",
    providerName: "anthropic",
    requestCount: 100,
    successCount: 95,
    errorCount: 5,
    avgLatencyMs: 500,
    lastErrorMessage: "rate limited",
    lastErrorAt: new Date("2025-06-01"),
    lastSuccessAt: new Date("2025-06-01"),
    updatedAt: new Date("2025-06-01"),
  },
]);

const mockGetToolStats = vi.fn().mockResolvedValue([
  {
    toolName: "search_web",
    totalExecutions: 50,
    successCount: 48,
    errorCount: 2,
    avgDurationMs: 1200,
    p95DurationMs: 3000,
    maxDurationMs: 5000,
  },
]);

const mockGetProviderHealthRecords = vi.fn().mockResolvedValue([]);
const mockUpsertProviderHealth = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn(),
  createTask: vi.fn(),
  updateGoalStatus: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  getTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
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
  getConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  getProviderHealthHistory: (...args: unknown[]) => mockGetProviderHealthHistory(...args),
  getProviderHealthRecords: (...args: unknown[]) => mockGetProviderHealthRecords(...args),
  upsertProviderHealth: (...args: unknown[]) => mockUpsertProviderHealth(...args),
  getToolStats: (...args: unknown[]) => mockGetToolStats(...args),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
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
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    seedStats = vi.fn();
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Provider Health History", () => {
  it("GET /health/providers/history — returns persisted health records", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/health/providers/history",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.timestamp).toBeDefined();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].providerName).toBe("anthropic");
    expect(body.records[0].requestCount).toBe(100);
    expect(mockGetProviderHealthHistory).toHaveBeenCalled();
  });

  it("GET /health/providers/history?provider=anthropic — filters by provider", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/health/providers/history?provider=anthropic",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(mockGetProviderHealthHistory).toHaveBeenCalledWith(expect.anything(), "anthropic");
  });
});

describe("Tool Stats", () => {
  it("GET /api/tools/stats — returns per-tool execution stats", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/api/tools/stats",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.timestamp).toBeDefined();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].toolName).toBe("search_web");
    expect(body.tools[0].avgDurationMs).toBe(1200);
    expect(body.tools[0].p95DurationMs).toBe(3000);
    expect(mockGetToolStats).toHaveBeenCalled();
  });
});

describe("Request Tracing", () => {
  it("generates x-request-id when not provided", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    await app.close();

    expect(res.headers["x-request-id"]).toBeDefined();
    expect(typeof res.headers["x-request-id"]).toBe("string");
    // Should be a UUID format
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("preserves x-request-id when provided in request", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "test-request-123" },
    });
    await app.close();

    expect(res.headers["x-request-id"]).toBe("test-request-123");
  });

  it("includes x-request-id on API endpoints", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/health/providers",
    });
    await app.close();

    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect((res.headers["x-request-id"] as string).length).toBeGreaterThan(0);
  });
});

describe("Observability — Route Exclusions", () => {
  const internalHeaders = { "x-forwarded-for": "10.0.0.1" };

  it("does not track duration for /metrics", async () => {
    const { app } = buildServer();

    // Make requests to both /health and /metrics
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    const body = res.payload;
    // Should have duration tracking for /health but not /metrics
    expect(body).toContain("http_request_duration_avg_ms");
    // /metrics route should not appear in duration metrics
    // (it appears in counters but not in the duration gauge)
    const durationLines = body
      .split("\n")
      .filter((l: string) => l.startsWith("http_request_duration_avg_ms{"));
    const metricsRouteDuration = durationLines.find((l: string) => l.includes('route="/metrics"'));
    expect(metricsRouteDuration).toBeUndefined();
  });

  it("includes tool_execution_duration_seconds histogram", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    const body = res.payload;
    expect(body).toContain("tool_execution_duration_seconds");
  });
});
