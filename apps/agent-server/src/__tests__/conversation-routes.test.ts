import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

const mockSearchMessages = vi.fn();
const mockListConversationsByUser = vi.fn();
const mockGetConversation = vi.fn();
const mockGetConversationMessages = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  searchMessages: (...args: unknown[]) => mockSearchMessages(...args),
  listConversationsByUser: (...args: unknown[]) => mockListConversationsByUser(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  // Required by transitive imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listApprovalsByTask: vi.fn().mockResolvedValue([]),
  resolveApproval: vi.fn(),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  countMemoriesByUser: vi.fn().mockResolvedValue(0),
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  createN8nWorkflow: vi.fn(),
  updateN8nWorkflow: vi.fn(),
  getN8nWorkflow: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  deleteN8nWorkflow: vi.fn(),
  findN8nWorkflowByEvent: vi.fn(),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  countEvents: vi.fn().mockResolvedValue(0),
  listEvents: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
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

describe("Conversation routes", () => {
  describe("GET /api/conversations/search", () => {
    it("searches messages by query", async () => {
      mockSearchMessages.mockResolvedValueOnce({
        data: [
          { id: "msg-1", content: "hello world", role: "user", conversationId: "conv-1", createdAt: new Date() },
        ],
        total: 1,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/conversations/search?q=hello",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.data[0].content).toBe("hello world");
    });

    it("passes filter parameters", async () => {
      mockSearchMessages.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      const convId = "00000000-0000-0000-0000-000000000001";
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations/search?q=test&conversationId=${convId}&role=agent&limit=10&offset=5`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockSearchMessages).toHaveBeenCalledWith(
        expect.anything(),
        "test",
        expect.objectContaining({
          conversationId: convId,
          role: "agent",
          limit: 10,
          offset: 5,
        }),
      );
    });

    it("rejects empty query", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/conversations/search?q=",
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects limit above 200", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/conversations/search?q=test&limit=500",
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/conversations", () => {
    it("lists conversations for a user", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockListConversationsByUser.mockResolvedValueOnce({
        data: [
          { id: "conv-1", title: "Test Conversation", userId, createdAt: new Date() },
        ],
        total: 1,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations?userId=${userId}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe("Test Conversation");
    });
  });

  describe("GET /api/conversations/:id", () => {
    it("returns a conversation by id", async () => {
      const convId = "00000000-0000-0000-0000-000000000001";
      mockGetConversation.mockResolvedValueOnce({
        id: convId,
        title: "My Conversation",
        userId: "user-1",
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations/${convId}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("My Conversation");
    });

    it("returns 404 when not found", async () => {
      const convId = "00000000-0000-0000-0000-000000000002";
      mockGetConversation.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations/${convId}`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/conversations/:id/messages", () => {
    it("returns messages for a conversation", async () => {
      const convId = "00000000-0000-0000-0000-000000000001";
      mockGetConversation.mockResolvedValueOnce({ id: convId });
      mockGetConversationMessages.mockResolvedValueOnce([
        { id: "msg-1", role: "user", content: "hi", createdAt: new Date() },
        { id: "msg-2", role: "agent", content: "hello", createdAt: new Date() },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations/${convId}/messages`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
    });

    it("returns 404 for non-existent conversation", async () => {
      const convId = "00000000-0000-0000-0000-000000000002";
      mockGetConversation.mockResolvedValueOnce(null);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/conversations/${convId}/messages`,
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });
});
