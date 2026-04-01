import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test",
}));

const mockDeleteGoal = vi.fn();
const mockCancelGoal = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  deleteGoal: (...args: unknown[]) => mockDeleteGoal(...args),
  cancelGoal: (...args: unknown[]) => mockCancelGoal(...args),
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

const { buildServer } = await import("../server.js");

let app: Awaited<ReturnType<typeof buildServer>>["app"];

beforeAll(() => {
  ({ app } = buildServer());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Goal delete/cancel routes", () => {
  it("DELETE /api/goals/:id — returns 200 when goal exists", async () => {
    mockDeleteGoal.mockResolvedValueOnce({ id: "00000000-0000-0000-0000-000000000001", title: "Test Goal" });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/goals/00000000-0000-0000-0000-000000000001",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(mockDeleteGoal).toHaveBeenCalledWith(expect.anything(), "00000000-0000-0000-0000-000000000001");
  });

  it("DELETE /api/goals/:id — returns 404 when goal does not exist", async () => {
    mockDeleteGoal.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/goals/00000000-0000-0000-0000-000000000099",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Goal not found");
  });

  it("PATCH /api/goals/:id/cancel — returns 200 with cancelled goal", async () => {
    const cancelledGoal = {
      id: "00000000-0000-0000-0000-000000000001",
      title: "Test Goal",
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    mockCancelGoal.mockResolvedValueOnce(cancelledGoal);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/00000000-0000-0000-0000-000000000001/cancel",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.status).toBe("cancelled");
    expect(mockCancelGoal).toHaveBeenCalledWith(expect.anything(), "00000000-0000-0000-0000-000000000001");
  });

  it("PATCH /api/goals/:id/cancel — returns 404 when goal does not exist", async () => {
    mockCancelGoal.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/goals/00000000-0000-0000-0000-000000000099/cancel",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Goal not found");
  });
});
