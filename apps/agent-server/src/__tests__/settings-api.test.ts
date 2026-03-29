import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

const mockGetAppSetting = vi.fn();
const mockUpsertAppSetting = vi.fn();
const mockGetUsageSummary = vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getAppSetting: (...args: unknown[]) => mockGetAppSetting(...args),
  upsertAppSetting: (...args: unknown[]) => mockUpsertAppSetting(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
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
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no app settings in DB
  mockGetAppSetting.mockResolvedValue(null);
  mockUpsertAppSetting.mockResolvedValue(undefined);
  mockGetUsageSummary.mockResolvedValue({
    totalCostUsd: 0,
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byProvider: {},
    byModel: {},
    byAgent: {},
  });
});

describe("GET /api/settings", () => {
  it("returns default 0 values when no DB rows exist", async () => {
    mockGetAppSetting.mockResolvedValue(null);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dailyBudgetUsd).toBe(0);
    expect(body.weeklyBudgetUsd).toBe(0);
  });

  it("returns stored values when DB rows exist", async () => {
    mockGetAppSetting.mockImplementation((_db: unknown, key: string) => {
      if (key === "daily_budget_usd") return Promise.resolve("50");
      if (key === "weekly_budget_usd") return Promise.resolve("200");
      return Promise.resolve(null);
    });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dailyBudgetUsd).toBe(50);
    expect(body.weeklyBudgetUsd).toBe(200);
  });
});

describe("PUT /api/settings/budget", () => {
  it("persists budget values and returns 200", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/budget",
      payload: { dailyUsd: 50, weeklyUsd: 200 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(mockUpsertAppSetting).toHaveBeenCalledTimes(2);
    expect(mockUpsertAppSetting).toHaveBeenCalledWith(expect.anything(), "daily_budget_usd", "50");
    expect(mockUpsertAppSetting).toHaveBeenCalledWith(expect.anything(), "weekly_budget_usd", "200");
  });

  it("returns 400 for negative dailyUsd", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/budget",
      payload: { dailyUsd: -10, weeklyUsd: 200 },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for negative weeklyUsd", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/budget",
      payload: { dailyUsd: 50, weeklyUsd: -5 },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/settings after PUT", () => {
  it("reflects updated values after PUT", async () => {
    // Simulate a PUT persisting values, then GET returning them
    mockGetAppSetting.mockImplementation((_db: unknown, key: string) => {
      if (key === "daily_budget_usd") return Promise.resolve("75");
      if (key === "weekly_budget_usd") return Promise.resolve("300");
      return Promise.resolve(null);
    });

    const { app } = buildServer();

    // First do a PUT
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/settings/budget",
      payload: { dailyUsd: 75, weeklyUsd: 300 },
    });
    expect(putRes.statusCode).toBe(200);

    // Then do a GET — mock returns new values
    const getRes = await app.inject({ method: "GET", url: "/api/settings" });
    await app.close();

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.dailyBudgetUsd).toBe(75);
    expect(body.weeklyBudgetUsd).toBe(300);
  });
});

describe("GET /api/usage/budget DB-first read", () => {
  it("reads budget limits from DB when available (not just env fallback)", async () => {
    // DB returns configured budgets
    mockGetAppSetting.mockImplementation((_db: unknown, key: string) => {
      if (key === "daily_budget_usd") return Promise.resolve("100");
      if (key === "weekly_budget_usd") return Promise.resolve("500");
      return Promise.resolve(null);
    });

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/usage/budget" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // With DB values of 100 and 500, limitUsd should reflect those values
    expect(body.daily.limitUsd).toBe(100);
    expect(body.weekly.limitUsd).toBe(500);
  });
});
