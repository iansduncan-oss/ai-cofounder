import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockDbExecute = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: (...args: unknown[]) => mockDbExecute(...args),
    transaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = { execute: (...args: unknown[]) => mockDbExecute(...args) };
      return fn(tx);
    },
  }),
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

describe("Database routes", () => {
  it("GET /api/database/query — returns results for valid SELECT", async () => {
    // First call: SET TRANSACTION READ ONLY, second call: actual query
    mockDbExecute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: 5 }]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/database/query?sql=SELECT+count(*)+FROM+goals",
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toEqual([{ count: 5 }]);
    expect(body.rowCount).toBe(1);
  });

  it("GET /api/database/query — returns 400 when sql param missing", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/database/query",
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("sql");
  });

  it("GET /api/database/query — returns 400 for dangerous SQL", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/database/query?sql=DROP+TABLE+goals",
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("read-only");
  });

  it("GET /api/database/query — returns 400 on query execution error", async () => {
    // First call (SET TRANSACTION READ ONLY) succeeds, second (query) fails
    mockDbExecute.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("syntax error"));

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/database/query?sql=SELECT+*+FROM",
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("syntax error");
  });
});
