import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockListJournalEntries = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockGetJournalEntry = vi.fn().mockResolvedValue(null);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listJournalEntries: (...args: unknown[]) => mockListJournalEntries(...args),
  getJournalEntry: (...args: unknown[]) => mockGetJournalEntry(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => `mock-${name}`,
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Test standup" }],
      model: "test",
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    seedStats = vi.fn();
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createLlmRegistry: () => new MockLlmRegistry(),
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    OllamaProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

describe("Journal Routes", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"];

  beforeAll(async () => {
    const server = await buildServer();
    app = server.app;
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/journal", () => {
    it("returns empty list", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      const res = await app.inject({ method: "GET", url: "/api/journal" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ data: [], total: 0 });
    });

    it("returns entries with filters", async () => {
      const entries = [
        { id: "je-1", entryType: "goal_completed", title: "Goal done", occurredAt: new Date().toISOString() },
      ];
      mockListJournalEntries.mockResolvedValueOnce({ data: entries, total: 1 });

      const res = await app.inject({
        method: "GET",
        url: "/api/journal?entryType=goal_completed&limit=10",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(mockListJournalEntries).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entryType: "goal_completed", limit: 10 }),
      );
    });

    it("passes search parameter", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      await app.inject({ method: "GET", url: "/api/journal?search=deploy" });
      expect(mockListJournalEntries).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ search: "deploy" }),
      );
    });

    it("passes goalId filter", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      const goalId = "00000000-0000-0000-0000-000000000001";
      await app.inject({ method: "GET", url: `/api/journal?goalId=${goalId}` });
      expect(mockListJournalEntries).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ goalId }),
      );
    });
  });

  describe("GET /api/journal/:id", () => {
    it("returns a single entry", async () => {
      const entry = { id: "je-1", entryType: "work_session", title: "Session" };
      mockGetJournalEntry.mockResolvedValueOnce(entry);

      const res = await app.inject({
        method: "GET",
        url: "/api/journal/00000000-0000-0000-0000-000000000001",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(entry);
    });

    it("returns 404 for missing entry", async () => {
      mockGetJournalEntry.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/journal/00000000-0000-0000-0000-000000000002",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/journal/standup", () => {
    it("returns standup for today", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      const res = await app.inject({ method: "GET", url: "/api/journal/standup" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("date");
      expect(body).toHaveProperty("narrative");
      expect(body).toHaveProperty("data");
    });

    it("returns standup for specific date", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      const res = await app.inject({
        method: "GET",
        url: "/api/journal/standup?date=2024-01-15",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.date).toBe("2024-01-15");
      expect(body.narrative).toContain("No activity");
    });
  });
});
