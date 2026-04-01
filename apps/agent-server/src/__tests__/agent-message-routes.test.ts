import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListAgentMessages = vi.fn();
const mockGetAgentMessage = vi.fn();
const mockGetMessageThread = vi.fn();
const mockListGoalMessages = vi.fn();
const mockGetAgentMessageStats = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listAgentMessages: (...args: unknown[]) => mockListAgentMessages(...args),
  getAgentMessage: (...args: unknown[]) => mockGetAgentMessage(...args),
  getMessageThread: (...args: unknown[]) => mockGetMessageThread(...args),
  listGoalMessages: (...args: unknown[]) => mockListGoalMessages(...args),
  getAgentMessageStats: (...args: unknown[]) => mockGetAgentMessageStats(...args),
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
    OllamaProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Agent message routes ────────────────────────────────────────────────

describe("Agent message routes", () => {
  describe("GET /api/agent-messages", () => {
    it("returns paginated messages with defaults", async () => {
      mockListAgentMessages.mockResolvedValueOnce({
        data: [
          { id: UUID, senderRole: "orchestrator", messageType: "request", subject: "Test" },
        ],
        total: 1,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/agent-messages",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(mockListAgentMessages).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          goalId: undefined,
          role: undefined,
          messageType: undefined,
          status: undefined,
          limit: undefined,
          offset: undefined,
        }),
      );
    });

    it("passes query filters", async () => {
      mockListAgentMessages.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages?goalId=${UUID}&role=coder&type=request&status=pending&limit=10&offset=5`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListAgentMessages).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          goalId: UUID,
          role: "coder",
          messageType: "request",
          status: "pending",
          limit: 10,
          offset: 5,
        }),
      );
    });
  });

  describe("GET /api/agent-messages/stats", () => {
    it("returns message stats", async () => {
      const stats = [
        { senderRole: "orchestrator", messageType: "request", count: 5, avgResponseMs: 1200 },
        { senderRole: "coder", messageType: "response", count: 3, avgResponseMs: null },
      ];
      mockGetAgentMessageStats.mockResolvedValueOnce(stats);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/agent-messages/stats",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(stats);
      expect(mockGetAgentMessageStats).toHaveBeenCalled();
    });
  });

  describe("GET /api/agent-messages/thread/:correlationId", () => {
    it("returns a message thread", async () => {
      const thread = [
        { id: UUID, messageType: "request", subject: "Question" },
        { id: UUID2, messageType: "response", subject: "Answer" },
      ];
      mockGetMessageThread.mockResolvedValueOnce(thread);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages/thread/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(thread);
      expect(mockGetMessageThread).toHaveBeenCalledWith(expect.anything(), UUID);
    });
  });

  describe("GET /api/agent-messages/goal/:goalId", () => {
    it("returns messages for a goal with pagination", async () => {
      mockListGoalMessages.mockResolvedValueOnce({
        data: [
          { id: UUID, senderRole: "orchestrator", subject: "Plan" },
        ],
        total: 1,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages/goal/${UUID}?limit=10&offset=0`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(mockListGoalMessages).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        { limit: 10, offset: 0 },
      );
    });

    it("uses default pagination when not specified", async () => {
      mockListGoalMessages.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages/goal/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListGoalMessages).toHaveBeenCalledWith(
        expect.anything(),
        UUID,
        { limit: undefined, offset: undefined },
      );
    });
  });

  describe("GET /api/agent-messages/:id", () => {
    it("returns a single message", async () => {
      const message = {
        id: UUID,
        senderRole: "coder",
        targetRole: "orchestrator",
        messageType: "response",
        subject: "Done",
        body: "Task completed",
        status: "pending",
      };
      mockGetAgentMessage.mockResolvedValueOnce(message);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(message);
      expect(mockGetAgentMessage).toHaveBeenCalledWith(expect.anything(), UUID);
    });

    it("returns 404 when message not found", async () => {
      mockGetAgentMessage.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/agent-messages/${UUID}`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Message not found" });
    });
  });
});
