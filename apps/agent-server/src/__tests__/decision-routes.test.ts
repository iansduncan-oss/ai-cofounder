import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

const mockListDecisions = vi.fn();
const mockSaveMemory = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listDecisions: (...args: unknown[]) => mockListDecisions(...args),
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
  // Required by transitive imports
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversation: vi.fn().mockResolvedValue(null),
  getConversationMessages: vi.fn().mockResolvedValue([]),
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
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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

describe("Decision routes", () => {
  describe("GET /api/decisions", () => {
    it("lists decisions for a user", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockListDecisions.mockResolvedValueOnce({
        data: [
          {
            id: "mem-1",
            key: "Use PostgreSQL",
            content: "Chose PostgreSQL over MongoDB",
            category: "decisions",
            metadata: { rationale: "Better for relational data" },
            createdAt: new Date(),
          },
        ],
        total: 1,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/decisions?userId=${userId}`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].key).toBe("Use PostgreSQL");
      expect(body.total).toBe(1);
    });

    it("supports search query parameter", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockListDecisions.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/decisions?userId=${userId}&q=database`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListDecisions).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        expect.objectContaining({ query: "database" }),
      );
    });

    it("supports pagination", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockListDecisions.mockResolvedValueOnce({ data: [], total: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: `/api/decisions?userId=${userId}&limit=10&offset=20`,
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListDecisions).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });
  });

  describe("POST /api/decisions", () => {
    it("creates a decision as a memory", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockSaveMemory.mockResolvedValueOnce({
        id: "mem-1",
        key: "Use TypeScript",
        content: "Chose TypeScript for type safety",
        category: "decisions",
        userId,
        metadata: {
          context: "Starting new project",
          alternatives: ["JavaScript", "Python"],
          rationale: "Better tooling and maintainability",
          recordedAt: expect.any(String),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/decisions",
        payload: {
          userId,
          title: "Use TypeScript",
          decision: "Chose TypeScript for type safety",
          context: "Starting new project",
          alternatives: ["JavaScript", "Python"],
          rationale: "Better tooling and maintainability",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      expect(mockSaveMemory).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId,
          category: "decisions",
          key: "Use TypeScript",
          content: "Chose TypeScript for type safety",
          metadata: expect.objectContaining({
            context: "Starting new project",
            alternatives: ["JavaScript", "Python"],
            rationale: "Better tooling and maintainability",
          }),
        }),
      );
    });

    it("creates a minimal decision with only required fields", async () => {
      const userId = "00000000-0000-0000-0000-000000000001";
      mockSaveMemory.mockResolvedValueOnce({
        id: "mem-2",
        key: "Quick Decision",
        content: "Just do it",
        category: "decisions",
        userId,
      });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/decisions",
        payload: {
          userId,
          title: "Quick Decision",
          decision: "Just do it",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
    });

    it("rejects missing required fields", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/decisions",
        payload: {
          userId: "00000000-0000-0000-0000-000000000001",
          // missing title and decision
        },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });
});
