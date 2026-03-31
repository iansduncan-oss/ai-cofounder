import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

const mockCreateApproval = vi.fn();
const mockGetApproval = vi.fn();
const mockListPendingApprovals = vi.fn();
const mockListApprovalsByTask = vi.fn();
const mockResolveApproval = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createApproval: (...args: unknown[]) => mockCreateApproval(...args),
  getApproval: (...args: unknown[]) => mockGetApproval(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  listApprovalsByTask: (...args: unknown[]) => mockListApprovalsByTask(...args),
  resolveApproval: (...args: unknown[]) => mockResolveApproval(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
});

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

describe("Approval routes", () => {
  describe("POST /api/approvals", () => {
    it("creates an approval and returns 201", async () => {
      mockCreateApproval.mockResolvedValueOnce({
        id: "approval-1",
        taskId: UUID,
        requestedBy: "orchestrator",
        reason: "Needs human review",
        status: "pending",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals",
        payload: {
          taskId: UUID,
          requestedBy: "orchestrator",
          reason: "Needs human review",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe("approval-1");
      expect(body.status).toBe("pending");
      expect(mockCreateApproval).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskId: UUID,
          requestedBy: "orchestrator",
          reason: "Needs human review",
        }),
      );
    });

    it("validates required fields", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals",
        payload: { taskId: UUID }, // missing requestedBy and reason
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("validates taskId is UUID format", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals",
        payload: {
          taskId: "not-a-uuid",
          requestedBy: "orchestrator",
          reason: "test",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/approvals/pending", () => {
    it("returns list of pending approvals", async () => {
      mockListPendingApprovals.mockResolvedValueOnce([
        { id: "approval-1", taskId: UUID, status: "pending" },
        { id: "approval-2", taskId: UUID2, status: "pending" },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending?limit=10",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListPendingApprovals).toHaveBeenCalledWith(expect.anything(), 10);
    });

    it("defaults limit to 50", async () => {
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/approvals/pending",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListPendingApprovals).toHaveBeenCalledWith(expect.anything(), 50);
    });
  });

  describe("GET /api/approvals/:id", () => {
    it("returns an approval by id", async () => {
      mockGetApproval.mockResolvedValueOnce({
        id: UUID,
        taskId: UUID2,
        status: "pending",
        reason: "Review needed",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/approvals/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().reason).toBe("Review needed");
    });

    it("returns 404 when approval not found", async () => {
      mockGetApproval.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/approvals/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Approval not found");
    });
  });

  describe("GET /api/approvals", () => {
    it("lists approvals for a task", async () => {
      mockListApprovalsByTask.mockResolvedValueOnce([
        { id: "approval-1", taskId: UUID, status: "approved" },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/approvals?taskId=${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(mockListApprovalsByTask).toHaveBeenCalledWith(expect.anything(), UUID);
    });
  });

  describe("PATCH /api/approvals/:id/resolve", () => {
    it("approves an approval", async () => {
      mockResolveApproval.mockResolvedValueOnce({
        id: UUID,
        status: "approved",
        decision: "Looks good, proceed",
        decidedBy: UUID2,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/approvals/${UUID}/resolve`,
        payload: {
          status: "approved",
          decision: "Looks good, proceed",
          decidedBy: UUID2,
        },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("approved");
      expect(mockResolveApproval).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        "approved",
        "Looks good, proceed",
        UUID2,
      );
    });

    it("rejects an approval", async () => {
      mockResolveApproval.mockResolvedValueOnce({
        id: UUID,
        status: "rejected",
        decision: "Needs more work",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/approvals/${UUID}/resolve`,
        payload: {
          status: "rejected",
          decision: "Needs more work",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("rejected");
    });

    it("returns 404 when approval not found", async () => {
      mockResolveApproval.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/approvals/${UUID}/resolve`,
        payload: {
          status: "approved",
          decision: "OK",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Approval not found");
    });

    it("validates status must be approved or rejected", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/approvals/${UUID}/resolve`,
        payload: {
          status: "invalid",
          decision: "test",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("requires decision field", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/approvals/${UUID}/resolve`,
        payload: {
          status: "approved",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });
});
