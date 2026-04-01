import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockFindUserByPlatform = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findUserByPlatform: (...args: unknown[]) => mockFindUserByPlatform(...args),
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

describe("User routes", () => {
  describe("GET /api/users/by-platform/:platform/:externalId", () => {
    it("returns a user by platform and external ID", async () => {
      mockFindUserByPlatform.mockResolvedValueOnce({
        id: "user-1",
        platform: "discord",
        externalId: "123456",
        displayName: "TestUser",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/users/by-platform/discord/123456",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("user-1");
      expect(res.json().platform).toBe("discord");
      expect(mockFindUserByPlatform).toHaveBeenCalledWith(
        expect.anything(),
        "discord",
        "123456",
      );
    });

    it("returns 404 when user not found", async () => {
      mockFindUserByPlatform.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/users/by-platform/slack/unknown",
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("User not found");
    });
  });
});
