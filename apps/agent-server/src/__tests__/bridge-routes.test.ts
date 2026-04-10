import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockListMemoriesByUser = vi.fn();
const mockGetPrimaryAdminUserId = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listMemoriesByUser: (...args: unknown[]) => mockListMemoriesByUser(...args),
  getPrimaryAdminUserId: (...args: unknown[]) => mockGetPrimaryAdminUserId(...args),
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

describe("Memory bridge routes", () => {
  describe("GET /api/bridge/snapshot", () => {
    it("returns a markdown snapshot for the primary admin", async () => {
      mockGetPrimaryAdminUserId.mockResolvedValue("admin-1");
      mockListMemoriesByUser.mockResolvedValue([
        {
          id: "m-1",
          category: "projects",
          key: "ai-cofounder",
          content: "Turborepo monorepo shipped v2 with memory bridge",
          importance: 90,
          source: "orchestrator",
          updatedAt: new Date("2026-04-09T00:00:00Z"),
          archivedAt: null,
        },
        {
          id: "m-2",
          category: "user_info",
          key: "timezone",
          content: "Works in Pacific time",
          importance: 80,
          source: null,
          updatedAt: new Date("2026-04-01T00:00:00Z"),
          archivedAt: null,
        },
      ]);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/bridge/snapshot" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        markdown: string;
        includedCount: number;
        excludedCount: number;
        userId: string;
      };
      expect(body.userId).toBe("admin-1");
      expect(body.includedCount).toBe(2);
      expect(body.excludedCount).toBe(0);
      expect(body.markdown).toContain("# Jarvis Memory Snapshot");
      expect(body.markdown).toContain("ai-cofounder");
      expect(body.markdown).toContain("timezone");
      // User Info section renders before Projects
      const userIdx = body.markdown.indexOf("## User Info");
      const projIdx = body.markdown.indexOf("## Projects");
      expect(userIdx).toBeGreaterThan(-1);
      expect(projIdx).toBeGreaterThan(userIdx);
    });

    it("returns 404 when no primary admin user exists and no override given", async () => {
      mockGetPrimaryAdminUserId.mockResolvedValue(null);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/bridge/snapshot" });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("No primary admin user");
    });

    it("accepts an explicit userId override without calling getPrimaryAdminUserId", async () => {
      mockListMemoriesByUser.mockResolvedValue([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/bridge/snapshot?userId=user-42&limit=5&perCategoryLimit=2",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockGetPrimaryAdminUserId).not.toHaveBeenCalled();
      // Pool size is max(limit * 2, 80) so still 80 for limit=5
      expect(mockListMemoriesByUser).toHaveBeenCalledWith(
        expect.anything(),
        "user-42",
        expect.objectContaining({ limit: 80 }),
      );
      const body = res.json() as { userId: string; includedCount: number };
      expect(body.userId).toBe("user-42");
      expect(body.includedCount).toBe(0);
    });

    it("filters archived memories out of the snapshot", async () => {
      mockGetPrimaryAdminUserId.mockResolvedValue("admin-1");
      mockListMemoriesByUser.mockResolvedValue([
        {
          id: "m-live",
          category: "projects",
          key: "current",
          content: "Live memory",
          importance: 70,
          source: null,
          updatedAt: new Date("2026-04-09T00:00:00Z"),
          archivedAt: null,
        },
        {
          id: "m-arch",
          category: "projects",
          key: "retired",
          content: "Archived memory",
          importance: 90,
          source: null,
          updatedAt: new Date("2026-04-09T00:00:00Z"),
          archivedAt: new Date("2026-03-01T00:00:00Z"),
        },
      ]);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/bridge/snapshot" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json() as { markdown: string; includedCount: number; excludedCount: number };
      expect(body.includedCount).toBe(1);
      expect(body.excludedCount).toBe(1);
      expect(body.markdown).toContain("current");
      expect(body.markdown).not.toContain("retired");
    });
  });
});
