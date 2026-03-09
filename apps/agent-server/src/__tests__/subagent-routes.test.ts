import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockCreateSubagentRun = vi.fn();
const mockGetSubagentRun = vi.fn();
const mockListSubagentRuns = vi.fn();
const mockUpdateSubagentRunStatus = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createSubagentRun: (...args: unknown[]) => mockCreateSubagentRun(...args),
  getSubagentRun: (...args: unknown[]) => mockGetSubagentRun(...args),
  listSubagentRuns: (...args: unknown[]) => mockListSubagentRuns(...args),
  updateSubagentRunStatus: (...args: unknown[]) => mockUpdateSubagentRunStatus(...args),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  listSchedules: vi.fn().mockResolvedValue([]),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  // Table references used by route registrations
  saveMemory: vi.fn().mockResolvedValue(null),
  createGoal: vi.fn().mockResolvedValue(null),
  createTask: vi.fn().mockResolvedValue(null),
  updateGoalStatus: vi.fn(),
  createApproval: vi.fn(),
  createMilestone: vi.fn(),
  getN8nWorkflowByName: vi.fn().mockResolvedValue(null),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  touchMemory: vi.fn(),
  recordToolExecution: vi.fn(),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}));

vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn().mockResolvedValue("job-1"),
  subagentChannel: vi.fn().mockReturnValue("channel:sub:test"),
  subagentHistoryKey: vi.fn().mockReturnValue("history:sub:test"),
  getAllQueueStatus: vi.fn().mockResolvedValue([]),
  getJobStatus: vi.fn().mockResolvedValue(null),
  pingRedis: vi.fn().mockResolvedValue(true),
  createPublisher: vi.fn().mockReturnValue({
    publish: vi.fn(),
    rpush: vi.fn(),
    expire: vi.fn(),
    quit: vi.fn(),
  }),
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
  }),
  goalChannel: vi.fn(),
  historyKey: vi.fn(),
  CHANNEL_PREFIX: "agent-events:",
  HISTORY_PREFIX: "agent-events:history:",
  SUBAGENT_CHANNEL_PREFIX: "agent-events:subagent:",
  SUBAGENT_HISTORY_PREFIX: "agent-events:subagent-history:",
  HISTORY_TTL_SECONDS: 3600,
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

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Subagent routes", () => {
  describe("POST /api/subagents", () => {
    it("spawns a subagent and returns 202", async () => {
      mockCreateSubagentRun.mockResolvedValueOnce({
        id: UUID,
        title: "Research task",
        status: "queued",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/subagents",
        payload: {
          title: "Research task",
          instruction: "Research the latest trends",
          conversationId: UUID2,
        },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.subagentRunId).toBe(UUID);
      expect(body.status).toBe("queued");
      expect(body.title).toBe("Research task");
      expect(mockCreateSubagentRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: "Research task",
          instruction: "Research the latest trends",
          conversationId: UUID2,
        }),
      );
    });
  });

  describe("GET /api/subagents/:id", () => {
    it("returns a subagent run when found", async () => {
      const run = {
        id: UUID,
        title: "Test run",
        status: "completed",
        output: "Done",
        createdAt: new Date().toISOString(),
      };
      mockGetSubagentRun.mockResolvedValueOnce(run);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/subagents/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe("Test run");
    });

    it("returns 404 when not found", async () => {
      mockGetSubagentRun.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/subagents/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/subagents (list)", () => {
    it("returns paginated subagent runs", async () => {
      mockListSubagentRuns.mockResolvedValueOnce({
        data: [
          { id: UUID, title: "Run 1", status: "completed" },
          { id: UUID2, title: "Run 2", status: "running" },
        ],
        total: 2,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/subagents?limit=10&offset=0",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it("passes filter params to repository", async () => {
      mockListSubagentRuns.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      await app.inject({
        method: "GET",
        url: `/api/subagents?goalId=${UUID}&status=running`,
      });
      await app.close();

      expect(mockListSubagentRuns).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          goalId: UUID,
          status: "running",
        }),
      );
    });
  });

  describe("POST /api/subagents/:id/cancel", () => {
    it("cancels a queued subagent", async () => {
      mockGetSubagentRun.mockResolvedValueOnce({
        id: UUID,
        status: "queued",
      });
      mockUpdateSubagentRunStatus.mockResolvedValueOnce({
        id: UUID,
        status: "cancelled",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: `/api/subagents/${UUID}/cancel`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
    });

    it("cancels a running subagent", async () => {
      mockGetSubagentRun.mockResolvedValueOnce({
        id: UUID,
        status: "running",
      });
      mockUpdateSubagentRunStatus.mockResolvedValueOnce({
        id: UUID,
        status: "cancelled",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: `/api/subagents/${UUID}/cancel`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockGetSubagentRun.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: `/api/subagents/${UUID}/cancel`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when already completed", async () => {
      mockGetSubagentRun.mockResolvedValueOnce({
        id: UUID,
        status: "completed",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: `/api/subagents/${UUID}/cancel`,
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot cancel");
    });
  });
});
