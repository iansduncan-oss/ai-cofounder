import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://localhost/test",
}));

const dbMocks = mockDbModule();
vi.mock("@ai-cofounder/db", () => dbMocks);

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
  class MockProvider { constructor(..._args: unknown[]) {} }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: MockProvider,
    GroqProvider: MockProvider,
    OpenRouterProvider: MockProvider,
    GeminiProvider: MockProvider,
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

describe("Context Routes", () => {
  let app: ReturnType<typeof buildServer>["app"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const server = buildServer();
    app = server.app;
    await app.ready();
  });

  it("GET /api/context/current returns context block", async () => {
    const res = await app.inject({ method: "GET", url: "/api/context/current" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("data");
  });

  it("GET /api/context/engagement returns null without userId", async () => {
    const res = await app.inject({ method: "GET", url: "/api/context/engagement" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ data: null });
  });

  it("PUT /api/context/timezone rejects missing fields", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/context/timezone",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /api/context/timezone rejects invalid timezone", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/context/timezone",
      payload: { userId: "user-1", timezone: "Invalid/Zone" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Invalid timezone");
  });

  it("PUT /api/context/timezone accepts valid timezone", async () => {
    dbMocks.setUserTimezone.mockResolvedValueOnce({ id: "user-1" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/context/timezone",
      payload: { userId: "user-1", timezone: "America/New_York" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).timezone).toBe("America/New_York");
  });

  it("GET /api/context/focus returns data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/context/focus?userId=user-1",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("data");
  });
});
