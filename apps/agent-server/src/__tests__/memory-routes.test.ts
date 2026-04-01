import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockListMemoriesByUser = vi.fn();
const mockCountMemoriesByUser = vi.fn();
const mockDeleteMemory = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listMemoriesByUser: (...args: unknown[]) => mockListMemoriesByUser(...args),
  countMemoriesByUser: (...args: unknown[]) => mockCountMemoriesByUser(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
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

describe("Memory routes", () => {
  describe("GET /api/memories", () => {
    it("lists memories for a user", async () => {
      mockListMemoriesByUser.mockResolvedValueOnce([
        { id: "mem-1", key: "Prefers dark mode", category: "preferences" },
        { id: "mem-2", key: "Uses TypeScript", category: "technical" },
      ]);
      mockCountMemoriesByUser.mockResolvedValueOnce(2);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/memories?userId=user-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it("returns 400 when userId is missing", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/memories",
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("supports pagination parameters", async () => {
      mockListMemoriesByUser.mockResolvedValueOnce([]);
      mockCountMemoriesByUser.mockResolvedValueOnce(0);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/memories?userId=user-1&limit=10&offset=20",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListMemoriesByUser).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });

    it("caps limit at 200", async () => {
      mockListMemoriesByUser.mockResolvedValueOnce([]);
      mockCountMemoriesByUser.mockResolvedValueOnce(0);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/memories?userId=user-1&limit=500",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListMemoriesByUser).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        expect.objectContaining({ limit: 200 }),
      );
    });
  });

  describe("DELETE /api/memories/:id", () => {
    it("deletes a memory", async () => {
      mockDeleteMemory.mockResolvedValueOnce({ id: "mem-1" });

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/memories/mem-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
      expect(res.json().id).toBe("mem-1");
    });

    it("returns 404 when memory not found", async () => {
      mockDeleteMemory.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/memories/mem-missing",
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });
});
