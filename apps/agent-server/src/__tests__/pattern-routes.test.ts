import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockCreatePattern = vi.fn().mockResolvedValue({
  id: "p-new",
  patternType: "recurring_action",
  description: "Test pattern",
  suggestedAction: "Do something",
  triggerCondition: {},
  confidence: 50,
  hitCount: 0,
  acceptCount: 0,
  isActive: true,
});
const mockUpdatePattern = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createPattern: (...args: unknown[]) => mockCreatePattern(...args),
  updatePattern: (...args: unknown[]) => mockUpdatePattern(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
  }
  return { LlmRegistry: MockLlmRegistry, createLlmRegistry: () => new MockLlmRegistry(), AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/rag", () => ({
  ingestText: vi.fn(),
}));

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Pattern Routes", () => {
  it("POST /api/patterns creates a pattern", async () => {
    const { app } = buildServer();

    const res = await app.inject({
      method: "POST",
      url: "/api/patterns",
      payload: {
        patternType: "recurring_action",
        description: "Test pattern",
        suggestedAction: "Do something",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreatePattern).toHaveBeenCalledOnce();
    const body = JSON.parse(res.body);
    expect(body.id).toBe("p-new");
    await app.close();
  });

  it("PATCH /api/patterns/:id updates pattern fields", async () => {
    mockUpdatePattern.mockResolvedValueOnce({
      id: "p-1",
      description: "Updated",
      confidence: 80,
    });

    const { app } = buildServer();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/patterns/550e8400-e29b-41d4-a716-446655440000",
      payload: {
        description: "Updated",
        confidence: 80,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockUpdatePattern).toHaveBeenCalledOnce();
    await app.close();
  });

  it("PATCH /api/patterns/:id returns 404 for missing pattern", async () => {
    mockUpdatePattern.mockResolvedValueOnce(undefined);

    const { app } = buildServer();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/patterns/550e8400-e29b-41d4-a716-446655440000",
      payload: { description: "Updated" },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
