import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

const mockCreateTask = vi.fn();
const mockGetTask = vi.fn();
const mockListTasksByGoal = vi.fn();
const mockCountTasksByGoal = vi.fn();
const mockListPendingTasks = vi.fn();
const mockAssignTask = vi.fn();
const mockStartTask = vi.fn();
const mockCompleteTask = vi.fn();
const mockFailTask = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  listTasksByGoal: (...args: unknown[]) => mockListTasksByGoal(...args),
  countTasksByGoal: (...args: unknown[]) => mockCountTasksByGoal(...args),
  listPendingTasks: (...args: unknown[]) => mockListPendingTasks(...args),
  assignTask: (...args: unknown[]) => mockAssignTask(...args),
  startTask: (...args: unknown[]) => mockStartTask(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  failTask: (...args: unknown[]) => mockFailTask(...args),
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

describe("Task routes", () => {
  describe("POST /api/tasks", () => {
    it("creates a task and returns 201", async () => {
      mockCreateTask.mockResolvedValueOnce({
        id: "task-1",
        goalId: UUID,
        title: "Implement feature",
        status: "pending",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          goalId: UUID,
          title: "Implement feature",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.title).toBe("Implement feature");
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ goalId: UUID, title: "Implement feature" }),
      );
    });

    it("creates a task with optional fields", async () => {
      mockCreateTask.mockResolvedValueOnce({
        id: "task-1",
        goalId: UUID,
        title: "Code review",
        assignedAgent: "reviewer",
        orderIndex: 2,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          goalId: UUID,
          title: "Code review",
          assignedAgent: "reviewer",
          orderIndex: 2,
          description: "Review the PR",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      expect(res.json().assignedAgent).toBe("reviewer");
    });

    it("validates goalId is UUID format", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          goalId: "not-a-uuid",
          title: "Test task",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("validates title is required", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: {
          goalId: UUID,
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/tasks/pending", () => {
    it("returns list of pending tasks", async () => {
      mockListPendingTasks.mockResolvedValueOnce([
        { id: "task-1", title: "Task A", status: "pending" },
        { id: "task-2", title: "Task B", status: "pending" },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/tasks/pending",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it("respects limit parameter", async () => {
      mockListPendingTasks.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/tasks/pending?limit=5",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListPendingTasks).toHaveBeenCalledWith(expect.anything(), 5, undefined);
    });

    it("defaults limit to 50", async () => {
      mockListPendingTasks.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/tasks/pending",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListPendingTasks).toHaveBeenCalledWith(expect.anything(), 50, undefined);
    });
  });

  describe("GET /api/tasks/:id", () => {
    it("returns a task by id", async () => {
      mockGetTask.mockResolvedValueOnce({
        id: UUID,
        goalId: UUID2,
        title: "Test Task",
        status: "pending",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("Test Task");
    });

    it("returns 404 when task not found", async () => {
      mockGetTask.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Task not found");
    });
  });

  describe("GET /api/tasks", () => {
    it("lists tasks for a goal with pagination", async () => {
      mockListTasksByGoal.mockResolvedValueOnce([
        { id: "task-1", title: "Task A" },
        { id: "task-2", title: "Task B" },
      ]);
      mockCountTasksByGoal.mockResolvedValueOnce(2);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks?goalId=${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it("passes pagination params to DB", async () => {
      mockListTasksByGoal.mockResolvedValueOnce([]);
      mockCountTasksByGoal.mockResolvedValueOnce(0);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks?goalId=${UUID}&limit=10&offset=20`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListTasksByGoal).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });

    it("caps limit at 200", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks?goalId=${UUID}&limit=500`,
      });
      await app.close();

      // Typebox validation rejects limit > 200
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/tasks/:id/assign", () => {
    it("assigns a task to an agent", async () => {
      mockAssignTask.mockResolvedValueOnce({
        id: UUID,
        assignedAgent: "coder",
        status: "assigned",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/assign`,
        payload: { agent: "coder" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().assignedAgent).toBe("coder");
      expect(mockAssignTask).toHaveBeenCalledWith(expect.anything(), UUID, "coder");
    });

    it("returns 404 when task not found", async () => {
      mockAssignTask.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/assign`,
        payload: { agent: "researcher" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Task not found");
    });

    it("validates agent is one of the allowed values", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/assign`,
        payload: { agent: "unknown-agent" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/tasks/:id/start", () => {
    it("marks task as running", async () => {
      mockStartTask.mockResolvedValueOnce({
        id: UUID,
        status: "running",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/start`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("running");
      expect(mockStartTask).toHaveBeenCalledWith(expect.anything(), UUID);
    });

    it("returns 404 when task not found", async () => {
      mockStartTask.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/start`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/tasks/:id/complete", () => {
    it("marks task as completed with result", async () => {
      mockCompleteTask.mockResolvedValueOnce({
        id: UUID,
        status: "completed",
        result: "Feature implemented successfully",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/complete`,
        payload: { result: "Feature implemented successfully" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("completed");
      expect(mockCompleteTask).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        "Feature implemented successfully",
      );
    });

    it("returns 404 when task not found", async () => {
      mockCompleteTask.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/complete`,
        payload: { result: "Done" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Task not found");
    });

    it("requires result field", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/complete`,
        payload: {},
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/tasks/:id/fail", () => {
    it("marks task as failed with error", async () => {
      mockFailTask.mockResolvedValueOnce({
        id: UUID,
        status: "failed",
        error: "Compilation error in main.ts",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/fail`,
        payload: { error: "Compilation error in main.ts" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("failed");
      expect(mockFailTask).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        "Compilation error in main.ts",
      );
    });

    it("returns 404 when task not found", async () => {
      mockFailTask.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/fail`,
        payload: { error: "Something went wrong" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Task not found");
    });

    it("requires error field", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/tasks/${UUID}/fail`,
        payload: {},
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });
});
