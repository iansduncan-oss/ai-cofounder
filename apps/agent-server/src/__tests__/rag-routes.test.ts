import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  delete process.env.JWT_SECRET;
  delete process.env.COOKIE_SECRET;
});

const mockGetChunkCount = vi.fn().mockResolvedValue(42);
const mockListIngestionStates = vi.fn().mockResolvedValue([]);
const mockDeleteChunksBySource = vi.fn().mockResolvedValue(undefined);
const mockRetrieve = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: (...args: unknown[]) => mockRetrieve(...args),
  ingestText: vi.fn(),
  ingestFiles: vi.fn(),
  needsReingestion: vi.fn().mockResolvedValue(false),
  shouldSkipFile: vi.fn().mockReturnValue(false),
  formatContext: vi.fn().mockReturnValue(""),
  chunkText: vi.fn().mockReturnValue([]),
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getChunkCount: (...args: unknown[]) => mockGetChunkCount(...args),
  listIngestionStates: (...args: unknown[]) => mockListIngestionStates(...args),
  deleteChunksBySource: (...args: unknown[]) => mockDeleteChunksBySource(...args),
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
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
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
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
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
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0, totalInputTokens: 0, totalOutputTokens: 0, byProvider: {}, byModel: {}, byAgent: {} }),
  countEvents: vi.fn().mockResolvedValue(0),
  listEvents: vi.fn().mockResolvedValue([]),
  createEvent: vi.fn(),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  searchChunksByVector: vi.fn().mockResolvedValue([]),
  getRecentConversationSummaries: vi.fn().mockResolvedValue([]),
  findAdminByEmail: vi.fn().mockResolvedValue(undefined),
  countAdminUsers: vi.fn().mockResolvedValue(0),
  listToolTierConfigs: vi.fn().mockResolvedValue([]),
  upsertToolTierConfig: vi.fn().mockResolvedValue({ id: "ttc-1" }),
  listExpiredPendingApprovals: vi.fn().mockResolvedValue([]),
  listPatterns: vi.fn().mockResolvedValue([]),
  getDeployCircuitBreaker: vi.fn().mockResolvedValue(null),
  upsertDeployCircuitBreaker: vi.fn().mockResolvedValue({ id: "cb-1" }),
  resetCircuitBreaker: vi.fn(),
  getRecentFailedDeployments: vi.fn().mockResolvedValue([]),
  upsertSessionEngagement: vi.fn().mockResolvedValue({ id: "se-1" }),
  getLatestSessionEngagement: vi.fn().mockResolvedValue(null),
  getUserTimezone: vi.fn().mockResolvedValue(null),
  setUserTimezone: vi.fn(),
  toolTierConfig: {},
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
    seedStats = vi.fn();
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    onCompletion: unknown = undefined;
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

describe("RAG routes", () => {
  describe("GET /api/rag/status", () => {
    it("returns status with chunk count and sources", async () => {
      mockGetChunkCount.mockResolvedValue(100);
      mockListIngestionStates.mockResolvedValue([
        {
          sourceType: "conversation",
          sourceId: "conv-1",
          lastIngestedAt: new Date("2025-01-01"),
          chunkCount: 50,
          lastCursor: "cursor-1",
        },
      ]);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/rag/status" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalChunks).toBe(100);
      expect(body.sources).toHaveLength(1);
      expect(body.sources[0].type).toBe("conversation");
    });
  });

  describe("POST /api/rag/ingest", () => {
    it("returns 503 when queue not enabled", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/rag/ingest",
        payload: { action: "ingest_text", sourceId: "test-1", content: "hello" },
      });
      await app.close();

      expect(res.statusCode).toBe(503);
    });
  });

  describe("GET /api/rag/chunks/count", () => {
    it("returns total chunk count", async () => {
      mockGetChunkCount.mockResolvedValue(42);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/rag/chunks/count" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(42);
      expect(body.sourceType).toBe("all");
    });

    it("filters by source type", async () => {
      mockGetChunkCount.mockResolvedValue(10);

      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/rag/chunks/count?sourceType=git" });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(10);
      expect(body.sourceType).toBe("git");
      expect(mockGetChunkCount).toHaveBeenCalledWith(expect.anything(), "git");
    });
  });

  describe("POST /api/rag/search", () => {
    it("returns 503 when no embedding service", async () => {
      const { app } = buildServer();
      // buildServer doesn't set up embeddingService by default in test mode
      const res = await app.inject({
        method: "POST",
        url: "/api/rag/search",
        payload: { query: "test query" },
      });
      await app.close();

      expect(res.statusCode).toBe(503);
    });

    it("returns search results when embedding service available", async () => {
      mockRetrieve.mockResolvedValue([
        {
          id: "chunk-1",
          content: "relevant content",
          sourceType: "conversation",
          sourceId: "conv-1",
          distance: 0.2,
          score: 0.8,
          metadata: null,
          tokenCount: 50,
        },
      ]);

      const { app } = buildServer();
      // Inject a mock embedding service
      (app as Record<string, unknown>).embeddingService = {
        embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/rag/search",
        payload: { query: "test query", limit: 5 },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].content).toBe("relevant content");
      expect(body.query).toBe("test query");
    });

    it("returns empty results for no matches", async () => {
      mockRetrieve.mockResolvedValue([]);

      const { app } = buildServer();
      (app as Record<string, unknown>).embeddingService = {
        embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/rag/search",
        payload: { query: "nonexistent topic" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toHaveLength(0);
    });
  });

  describe("DELETE /api/rag/sources/:sourceType/:sourceId", () => {
    it("deletes chunks for a source", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/rag/sources/conversation/conv-1",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deleted).toBe(true);
      expect(body.sourceType).toBe("conversation");
      expect(body.sourceId).toBe("conv-1");
      expect(mockDeleteChunksBySource).toHaveBeenCalledWith(
        expect.anything(),
        "conversation",
        "conv-1",
      );
    });
  });
});
