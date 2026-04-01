import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockGetChannelConversation = vi.fn();
const mockUpsertChannelConversation = vi.fn();
const mockDeleteChannelConversation = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getChannelConversation: (...args: unknown[]) => mockGetChannelConversation(...args),
  upsertChannelConversation: (...args: unknown[]) => mockUpsertChannelConversation(...args),
  deleteChannelConversation: (...args: unknown[]) => mockDeleteChannelConversation(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Channel routes", () => {
  describe("GET /api/channels/:channelId/conversation", () => {
    it("returns the conversation for a channel", async () => {
      mockGetChannelConversation.mockResolvedValueOnce({
        channelId: "ch-1",
        conversationId: "conv-1",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/channels/ch-1/conversation",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().conversationId).toBe("conv-1");
    });

    it("returns 404 when no conversation mapped", async () => {
      mockGetChannelConversation.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/channels/ch-missing/conversation",
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /api/channels/:channelId/conversation", () => {
    it("upserts a channel-conversation mapping", async () => {
      mockUpsertChannelConversation.mockResolvedValueOnce({
        channelId: "ch-1",
        conversationId: "conv-2",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PUT",
        url: "/api/channels/ch-1/conversation",
        payload: { conversationId: "conv-2", platform: "discord" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().conversationId).toBe("conv-2");
      expect(mockUpsertChannelConversation).toHaveBeenCalledWith(
        expect.anything(),
        "ch-1",
        "conv-2",
        "discord",
      );
    });
  });

  describe("DELETE /api/channels/:channelId/conversation", () => {
    it("deletes a channel-conversation mapping", async () => {
      mockDeleteChannelConversation.mockResolvedValueOnce(undefined);

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/channels/ch-1/conversation",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });
  });
});
