import { describe, it, expect, vi, beforeAll } from "vitest";

// Set env before any imports that read it
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// Mock the DB package so tests don't need a real Postgres connection
vi.mock("@ai-cofounder/db", () => {
  const mocks: Record<string, unknown> = {
    createDb: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    }),
    findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
    createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
    createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal" }),
    createTask: vi.fn().mockResolvedValue({
      id: "task-1",
      title: "Test Task",
      assignedAgent: "researcher",
      orderIndex: 0,
    }),
    updateGoalStatus: vi.fn().mockResolvedValue({}),
    saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
    recallMemories: vi.fn().mockResolvedValue([]),
    searchMemoriesByVector: vi.fn().mockResolvedValue([]),
    getGoal: vi.fn(),
    listGoalsByConversation: vi.fn().mockResolvedValue([]),
    getTask: vi.fn(),
    listTasksByGoal: vi.fn().mockResolvedValue([]),
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
    deleteMemory: vi.fn(),
    getChannelConversation: vi.fn(),
    upsertChannelConversation: vi.fn(),
    getConversation: vi.fn(),
    findUserByPlatform: vi.fn().mockResolvedValue(null),
    getActivePrompt: vi.fn().mockResolvedValue(null),
    getActivePersona: vi.fn().mockResolvedValue(null),
    getPromptVersion: vi.fn().mockResolvedValue(null),
    listPromptVersions: vi.fn().mockResolvedValue([]),
    createPromptVersion: vi.fn().mockResolvedValue({ id: "p-1", name: "test", version: 1 }),
    goals: {},
    channelConversations: {},
    prompts: {},
  };
  return new Proxy(mocks, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) {
        const fn = vi.fn().mockResolvedValue(null);
        target[prop] = fn;
        return fn;
      }
      return Reflect.get(target, prop, receiver);
    },
    has() { return true; },
  });
});

// Mock the LLM package with a fake registry
vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock orchestrator response" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "anthropic",
  });

  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
  }

  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {
      constructor() {}
    },
    GroqProvider: class {
      constructor() {}
    },
    OpenRouterProvider: class {
      constructor() {}
    },
    GeminiProvider: class {
      constructor() {}
    },
    createEmbeddingService: vi.fn(),
  };
});

// Dynamic import after mocks are set up
const { buildServer } = await import("../server.js");

describe("agent-server", () => {
  describe("GET /health", () => {
    it("returns status ok", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
      expect(typeof body.uptime).toBe("number");
    });
  });

  describe("POST /api/agents/run", () => {
    it("returns orchestrator response", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Hello, AI Cofounder" },
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.agentRole).toBe("orchestrator");
      expect(body.conversationId).toBeDefined();
      expect(body.response).toBe("Mock orchestrator response");
      expect(body.model).toBeDefined();
      expect(body.usage).toBeDefined();
    });

    it("preserves conversationId when provided", async () => {
      const { app } = buildServer();
      const conversationId = "test-conv-123";
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "test", conversationId },
      });
      await app.close();

      const body = response.json();
      expect(body.conversationId).toBe(conversationId);
    });

    it("returns 400 when message is missing", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: {},
      });
      await app.close();

      expect(response.statusCode).toBe(400);
    });
  });
});
