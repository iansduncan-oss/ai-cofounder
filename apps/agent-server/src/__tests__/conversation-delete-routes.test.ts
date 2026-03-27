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

const mockDeleteConversation = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  deleteConversation: (...args: unknown[]) => mockDeleteConversation(...args),
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

describe("Conversation delete routes", () => {
  it("DELETE /api/conversations/:id — returns 200 when conversation exists", async () => {
    mockDeleteConversation.mockResolvedValueOnce({ id: "00000000-0000-0000-0000-000000000001", title: "Test Chat" });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/conversations/00000000-0000-0000-0000-000000000001",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(mockDeleteConversation).toHaveBeenCalledWith(expect.anything(), "00000000-0000-0000-0000-000000000001");
  });

  it("DELETE /api/conversations/:id — returns 404 when conversation does not exist", async () => {
    mockDeleteConversation.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/conversations/00000000-0000-0000-0000-000000000099",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Conversation not found");
  });
});
