import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockGetThinkingTraces = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getThinkingTraces: (...args: unknown[]) => mockGetThinkingTraces(...args),
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

describe("Thinking routes", () => {
  describe("GET /api/thinking/:conversationId", () => {
    it("returns thinking traces for a conversation", async () => {
      mockGetThinkingTraces.mockResolvedValueOnce([
        {
          id: "trace-1",
          conversationId: "conv-1",
          content: "Let me analyze this request...",
          requestId: "req-1",
          createdAt: new Date(),
        },
        {
          id: "trace-2",
          conversationId: "conv-1",
          content: "Considering alternatives...",
          requestId: "req-1",
          createdAt: new Date(),
        },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/thinking/conv-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().traces).toHaveLength(2);
      expect(mockGetThinkingTraces).toHaveBeenCalledWith(
        expect.anything(),
        "conv-1",
        undefined,
      );
    });

    it("filters by requestId when provided", async () => {
      mockGetThinkingTraces.mockResolvedValueOnce([
        {
          id: "trace-1",
          conversationId: "conv-1",
          content: "Thinking...",
          requestId: "req-42",
        },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/thinking/conv-1?requestId=req-42",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().traces).toHaveLength(1);
      expect(mockGetThinkingTraces).toHaveBeenCalledWith(
        expect.anything(),
        "conv-1",
        "req-42",
      );
    });

    it("returns empty array when no traces exist", async () => {
      mockGetThinkingTraces.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/thinking/conv-empty",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().traces).toHaveLength(0);
    });
  });
});
