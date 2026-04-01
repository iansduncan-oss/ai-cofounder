import { describe, it, expect, vi, beforeAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  findAdminByEmail: vi.fn(),
  findAdminById: vi.fn(),
  createAdminUser: vi.fn(),
  countAdminUsers: vi.fn().mockResolvedValue(1),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversation: vi.fn().mockResolvedValue(null),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test", status: "active" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn(),
  updateGoalMetadata: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ id: "mem-1" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  recordLlmUsage: vi.fn(),
  recordToolExecution: vi.fn(),
  saveCodeExecution: vi.fn(),
  getGoalAnalytics: vi.fn().mockResolvedValue({ byStatus: {}, byPriority: {}, completionRate: 0, totalGoals: 0, trend: [], taskSuccessRate: 0, totalTasks: 0, tasksByAgent: [] }),
  getAgentPerformanceStats: vi.fn().mockResolvedValue([]),
  listAdminUsers: vi.fn().mockResolvedValue([]),
}));

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Mock response" }],
  model: "test-model",
  stop_reason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 20 },
  provider: "test",
});

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    onCompletion = vi.fn();
    getCircuitBreakerStates = vi.fn().mockReturnValue([]);
    getTotalCost = vi.fn().mockReturnValue(0);
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

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, defaultValue: string) => process.env[name] ?? defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

const { buildServer } = await import("../server.js");

function signToken(app: { jwt: { sign: (payload: Record<string, unknown>, opts?: Record<string, unknown>) => string } }, role: string) {
  return app.jwt.sign({ sub: "user-1", email: "test@test.com", role }, { expiresIn: "15m" });
}

describe("RBAC middleware", () => {
  it("viewer gets 403 on POST (write) requests", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "viewer");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "POST",
      url: "/api/goals",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: "00000000-0000-0000-0000-000000000001", title: "Test goal" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("viewer");
    await app.close();
  });

  it("editor gets through on POST (write) requests", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "editor");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "POST",
      url: "/api/goals",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: "00000000-0000-0000-0000-000000000001", title: "Test goal" },
    });

    // Should not be 403 — may be 200 or 400 depending on validation
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it("admin gets through on POST (write) requests", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "admin");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "POST",
      url: "/api/goals",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: "00000000-0000-0000-0000-000000000001", title: "Test goal" },
    });

    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it("viewer gets 200 on GET (read) requests", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "viewer");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "GET",
      url: "/api/goals/analytics",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("editor gets 403 on admin-only paths", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "editor");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("admin");
    await app.close();
  });

  it("admin gets through on admin-only paths", async () => {
    const { app } = buildServer();
    await app.ready();
    const token = signToken(app, "admin");

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it("missing role in JWT defaults to viewer (backwards compat)", async () => {
    const { app } = buildServer();
    await app.ready();
    // Sign token WITHOUT role claim
    const token = app.jwt.sign({ sub: "user-1", email: "test@test.com" }, { expiresIn: "15m" });

    const res = await app.inject({ remoteAddress: "203.0.113.1",
      method: "POST",
      url: "/api/goals",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: "00000000-0000-0000-0000-000000000001", title: "Test goal" },
    });

    // Should be 403 because missing role defaults to viewer
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
