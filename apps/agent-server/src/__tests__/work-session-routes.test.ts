import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.BRIEFING_HOUR = "25";
delete process.env.JWT_SECRET;
delete process.env.COOKIE_SECRET;

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

const mockListWorkSessionsFiltered = vi.fn();
const mockGetWorkSession = vi.fn();
const mockCancelWorkSession = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listWorkSessionsFiltered: (...args: unknown[]) => mockListWorkSessionsFiltered(...args),
  getWorkSession: (...args: unknown[]) => mockGetWorkSession(...args),
  cancelWorkSession: (...args: unknown[]) => mockCancelWorkSession(...args),
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
    OllamaProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("@ai-cofounder/queue", () => ({
  createRedisConnection: vi.fn(),
  registerQueues: vi.fn(),
  enqueueAgentTask: vi.fn(),
  getJobStatus: vi.fn().mockResolvedValue(null),
}));

const { buildServer } = await import("../server.js");

let app: Awaited<ReturnType<typeof buildServer>>["app"];

const MOCK_SESSION = {
  id: "sess-1",
  trigger: "schedule",
  scheduleId: null,
  eventId: null,
  goalId: "goal-1",
  status: "running",
  tokensUsed: 500,
  durationMs: 12000,
  actionsTaken: [{ action: "test", result: "ok" }],
  summary: null,
  context: null,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

afterAll(async () => {
  if (app) await app.close();
});

describe("Work Session Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/work-sessions", () => {
    it("returns paginated list", async () => {
      mockListWorkSessionsFiltered.mockResolvedValueOnce({ data: [MOCK_SESSION], total: 1 });
      const server = buildServer();
      app = server.app;
      const res = await app.inject({ method: "GET", url: "/api/work-sessions?limit=10&offset=0" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });
  });

  describe("GET /api/work-sessions/:id", () => {
    it("returns single session", async () => {
      mockGetWorkSession.mockResolvedValueOnce(MOCK_SESSION);
      const server = buildServer();
      app = server.app;
      const res = await app.inject({ method: "GET", url: "/api/work-sessions/sess-1" });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("sess-1");
    });

    it("returns 404 when not found", async () => {
      mockGetWorkSession.mockResolvedValueOnce(null);
      const server = buildServer();
      app = server.app;
      const res = await app.inject({ method: "GET", url: "/api/work-sessions/missing" });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/work-sessions/:id/cancel", () => {
    it("cancels running session", async () => {
      mockCancelWorkSession.mockResolvedValueOnce({ ...MOCK_SESSION, status: "failed", summary: "Cancelled by user" });
      const server = buildServer();
      app = server.app;
      const res = await app.inject({ method: "PATCH", url: "/api/work-sessions/sess-1/cancel" });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("failed");
    });

    it("returns 404 when not found or not running", async () => {
      mockCancelWorkSession.mockResolvedValueOnce(null);
      const server = buildServer();
      app = server.app;
      const res = await app.inject({ method: "PATCH", url: "/api/work-sessions/missing/cancel" });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });
});
