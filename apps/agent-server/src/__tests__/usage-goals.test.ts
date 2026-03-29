import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockGetCostByGoal = vi.fn();
const mockGetTopExpensiveGoals = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getCostByGoal: (...args: unknown[]) => mockGetCostByGoal(...args),
  getTopExpensiveGoals: (...args: unknown[]) => mockGetTopExpensiveGoals(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => `mock-${name}`,
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
    seedStats = vi.fn();
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

describe("Usage Goal Routes", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"];

  beforeAll(async () => {
    const server = await buildServer();
    app = server.app;
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe("GET /api/usage/by-goal/:id", () => {
    it("returns cost summary for a goal", async () => {
      mockGetCostByGoal.mockResolvedValueOnce({
        totalCostUsd: 0.1234,
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
        requestCount: 10,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/usage/by-goal/goal-123",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCostUsd).toBe(0.1234);
      expect(body.totalInputTokens).toBe(5000);
      expect(body.totalOutputTokens).toBe(2000);
      expect(body.requestCount).toBe(10);
      expect(mockGetCostByGoal).toHaveBeenCalledWith(expect.anything(), "goal-123");
    });
  });

  describe("GET /api/usage/top-goals", () => {
    it("returns top expensive goals with default limit", async () => {
      const mockGoals = [
        { goalId: "g-1", goalTitle: "Build feature", totalCostUsd: 0.5, totalInputTokens: 10000, totalOutputTokens: 5000, requestCount: 20 },
        { goalId: "g-2", goalTitle: "Fix bug", totalCostUsd: 0.2, totalInputTokens: 4000, totalOutputTokens: 2000, requestCount: 8 },
      ];
      mockGetTopExpensiveGoals.mockResolvedValueOnce(mockGoals);

      const res = await app.inject({
        method: "GET",
        url: "/api/usage/top-goals",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].goalTitle).toBe("Build feature");
      expect(mockGetTopExpensiveGoals).toHaveBeenCalledWith(
        expect.anything(),
        { limit: 10, since: undefined },
      );
    });

    it("respects limit and since query params", async () => {
      mockGetTopExpensiveGoals.mockResolvedValueOnce([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/usage/top-goals?limit=5&since=2025-01-01T00:00:00Z",
      });

      expect(res.statusCode).toBe(200);
      expect(mockGetTopExpensiveGoals).toHaveBeenCalledWith(
        expect.anything(),
        { limit: 5, since: expect.any(Date) },
      );
    });

    it("caps limit at 50", async () => {
      mockGetTopExpensiveGoals.mockResolvedValueOnce([]);

      await app.inject({
        method: "GET",
        url: "/api/usage/top-goals?limit=100",
      });

      expect(mockGetTopExpensiveGoals).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 50 }),
      );
    });
  });
});
