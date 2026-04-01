import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockCreateMilestone = vi.fn();
const mockGetMilestone = vi.fn();
const mockListMilestonesByConversation = vi.fn();
const mockUpdateMilestoneStatus = vi.fn();
const mockGetMilestoneProgress = vi.fn();
const mockAssignGoalToMilestone = vi.fn();
const mockDeleteMilestone = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createMilestone: (...args: unknown[]) => mockCreateMilestone(...args),
  getMilestone: (...args: unknown[]) => mockGetMilestone(...args),
  listMilestonesByConversation: (...args: unknown[]) => mockListMilestonesByConversation(...args),
  updateMilestoneStatus: (...args: unknown[]) => mockUpdateMilestoneStatus(...args),
  getMilestoneProgress: (...args: unknown[]) => mockGetMilestoneProgress(...args),
  assignGoalToMilestone: (...args: unknown[]) => mockAssignGoalToMilestone(...args),
  deleteMilestone: (...args: unknown[]) => mockDeleteMilestone(...args),
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

describe("Milestone routes", () => {
  describe("POST /api/milestones", () => {
    it("creates a milestone", async () => {
      mockCreateMilestone.mockResolvedValueOnce({
        id: "ms-1",
        title: "MVP Launch",
        conversationId: "conv-1",
        status: "planned",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/milestones",
        payload: {
          conversationId: "00000000-0000-0000-0000-000000000001",
          title: "MVP Launch",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("MVP Launch");
      expect(mockCreateMilestone).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: "MVP Launch" }),
      );
    });
  });

  describe("GET /api/milestones/:id", () => {
    it("returns a milestone", async () => {
      mockGetMilestone.mockResolvedValueOnce({
        id: "ms-1",
        title: "MVP Launch",
        status: "planned",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/milestones/ms-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("MVP Launch");
    });

    it("returns 404 for missing milestone", async () => {
      mockGetMilestone.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/milestones/ms-missing",
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/milestones/conversation/:conversationId", () => {
    it("lists milestones for a conversation", async () => {
      mockListMilestonesByConversation.mockResolvedValueOnce([
        { id: "ms-1", title: "Phase 1" },
        { id: "ms-2", title: "Phase 2" },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/milestones/conversation/conv-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });
  });

  describe("PATCH /api/milestones/:id/status", () => {
    it("updates milestone status", async () => {
      mockUpdateMilestoneStatus.mockResolvedValueOnce({
        id: "ms-1",
        status: "in_progress",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/milestones/ms-1/status",
        payload: { status: "in_progress" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("in_progress");
    });

    it("returns 404 for missing milestone", async () => {
      mockUpdateMilestoneStatus.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/milestones/ms-missing/status",
        payload: { status: "completed" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/milestones/:id/progress", () => {
    it("returns milestone progress", async () => {
      mockGetMilestoneProgress.mockResolvedValueOnce({
        total: 5,
        completed: 3,
        percent: 60,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/milestones/ms-1/progress",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().percent).toBe(60);
    });
  });

  describe("POST /api/milestones/:id/goals", () => {
    it("assigns a goal to a milestone", async () => {
      mockAssignGoalToMilestone.mockResolvedValueOnce({
        id: "goal-1",
        milestoneId: "ms-1",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/milestones/ms-1/goals",
        payload: { goalId: "00000000-0000-0000-0000-000000000001" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when goal not found", async () => {
      mockAssignGoalToMilestone.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/milestones/ms-1/goals",
        payload: { goalId: "00000000-0000-0000-0000-000000000002" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/milestones/:id", () => {
    it("deletes a milestone", async () => {
      mockDeleteMilestone.mockResolvedValueOnce({ id: "ms-1" });

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/milestones/ms-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("deleted");
    });

    it("returns 404 for missing milestone", async () => {
      mockDeleteMilestone.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/milestones/ms-missing",
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });
});
