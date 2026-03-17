import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mockDbModule, setupTestEnv } from "@ai-cofounder/test-utils";

setupTestEnv();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

const dbMocks = mockDbModule();
vi.mock("@ai-cofounder/db", () => dbMocks);

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], usage: { inputTokens: 10, outputTokens: 5 } });
    completeDirect = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], usage: { inputTokens: 10, outputTokens: 5 } });
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getCircuitBreakerStates = vi.fn().mockReturnValue({});
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    seedStats = vi.fn();
    onCompletion: unknown = undefined;
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

vi.mock("@ai-cofounder/queue", () => ({
  pingRedis: vi.fn().mockResolvedValue("ok"),
  getAllQueueStatus: vi.fn().mockResolvedValue([]),
  setupRecurringJobs: vi.fn(),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn(),
}));

const { buildServer } = await import("../server.js");

describe("GET /api/errors/summary", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (!app) app = await buildServer();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("returns empty state when no errors", async () => {
    dbMocks.getErrorSummary.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/errors/summary" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalErrors).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.hours).toBe(24);
  });

  it("returns aggregated errors", async () => {
    dbMocks.getErrorSummary.mockResolvedValue([
      { toolName: "search_web", errorMessage: "Tavily timeout", count: 5, lastSeen: "2026-03-17T00:00:00Z" },
      { toolName: "execute_code", errorMessage: "Docker unavailable", count: 3, lastSeen: "2026-03-16T23:00:00Z" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/errors/summary" });
    const body = JSON.parse(res.payload);
    expect(body.totalErrors).toBe(8);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].toolName).toBe("search_web");
  });

  it("respects hours query param", async () => {
    dbMocks.getErrorSummary.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/errors/summary?hours=48" });
    expect(dbMocks.getErrorSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 20 }),
    );
    const call = dbMocks.getErrorSummary.mock.calls[0];
    expect(call[1].since).toBeInstanceOf(Date);
  });

  it("respects limit query param", async () => {
    dbMocks.getErrorSummary.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/api/errors/summary?limit=5" });
    expect(dbMocks.getErrorSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 5 }),
    );
  });
});
