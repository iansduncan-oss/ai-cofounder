import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockGetActivePersona = vi.fn();
const mockListPersonas = vi.fn();
const mockUpsertPersona = vi.fn();
const mockDeletePersona = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  getActivePersona: (...args: unknown[]) => mockGetActivePersona(...args),
  listPersonas: (...args: unknown[]) => mockListPersonas(...args),
  upsertPersona: (...args: unknown[]) => mockUpsertPersona(...args),
  deletePersona: (...args: unknown[]) => mockDeletePersona(...args),
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

describe("Persona routes", () => {
  describe("GET /api/persona", () => {
    it("returns the active persona", async () => {
      mockGetActivePersona.mockResolvedValueOnce({
        id: "persona-1",
        name: "JARVIS",
        systemPrompt: "You are JARVIS",
        isActive: true,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/persona",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().persona.name).toBe("JARVIS");
    });

    it("returns null when no active persona", async () => {
      mockGetActivePersona.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/persona",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().persona).toBeNull();
    });
  });

  describe("GET /api/persona/all", () => {
    it("lists all personas", async () => {
      mockListPersonas.mockResolvedValueOnce([
        { id: "p-1", name: "JARVIS", isActive: true },
        { id: "p-2", name: "Friday", isActive: false },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/persona/all",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().personas).toHaveLength(2);
    });
  });

  describe("PUT /api/persona", () => {
    it("creates or updates a persona", async () => {
      mockUpsertPersona.mockResolvedValueOnce({
        id: "persona-1",
        name: "JARVIS",
        systemPrompt: "You are JARVIS",
        isActive: true,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PUT",
        url: "/api/persona",
        payload: {
          name: "JARVIS",
          corePersonality: "You are JARVIS, a helpful AI assistant",
          isActive: true,
        },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().persona.name).toBe("JARVIS");
      expect(mockUpsertPersona).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: "JARVIS" }),
      );
    });
  });

  describe("DELETE /api/persona/:id", () => {
    it("deletes a persona", async () => {
      mockDeletePersona.mockResolvedValueOnce(undefined);

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/persona/00000000-0000-0000-0000-000000000001",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });
  });
});
