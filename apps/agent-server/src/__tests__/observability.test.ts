import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

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

describe("Observability Plugin", () => {
  const internalHeaders = { "x-forwarded-for": "10.0.0.1" };

  it("GET /metrics — returns Prometheus-format metrics from internal IP", async () => {
    const { app } = buildServer();

    // Make a request first to populate counters
    await app.inject({ method: "GET", url: "/health" });

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");

    const body = res.payload;
    // Should contain standard Prometheus metrics
    expect(body).toContain("http_requests_total");
    expect(body).toContain("process_memory_rss_bytes");
    expect(body).toContain("process_uptime_seconds");
  });

  it("GET /metrics — blocked from external IP", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      remoteAddress: "203.0.113.50",
      headers: { "x-forwarded-for": "203.0.113.50" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("tracks request counters after a health check", async () => {
    const { app } = buildServer();

    // Make a few requests to generate metrics
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    const body = res.payload;
    // Should have counted the health requests
    expect(body).toContain("http_requests_total");
    expect(body).toContain('route="/health"');
    expect(body).toContain("http_requests_by_status");
    expect(body).toContain('status="2xx"');
  });

  it("tracks request duration averages", async () => {
    const { app } = buildServer();

    await app.inject({ method: "GET", url: "/health" });

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: internalHeaders,
    });
    await app.close();

    const body = res.payload;
    expect(body).toContain("http_request_duration_avg_ms");
  });
});
