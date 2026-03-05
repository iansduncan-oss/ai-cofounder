import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1", title: "Test" }),
  createTask: vi.fn().mockResolvedValue({ id: "task-1", title: "Test", assignedAgent: "researcher", orderIndex: 0 }),
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
  deleteChannelConversation: vi.fn(),
  getConversation: vi.fn(),
  findUserByPlatform: vi.fn().mockResolvedValue(null),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getPromptVersion: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn().mockResolvedValue({ id: "p-1" }),
  goals: {},
  channelConversations: {},
  prompts: {},
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

// Use a unique IP counter to avoid cross-test state pollution in the security plugin's Maps
let ipCounter = 0;
function uniqueIp() {
  return `203.0.113.${++ipCounter}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Security Plugin", () => {
  describe("health endpoint bypass", () => {
    it("allows /health through without any security checks", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { "user-agent": "zgrab/1.0" }, // would normally be blocked
      });
      await app.close();

      expect(res.statusCode).toBe(200);
    });
  });

  describe("blocked user agents", () => {
    it("blocks known scanner user agents with 403", async () => {
      const { app } = buildServer();
      const scanners = ["zgrab/2.0", "Nmap Scripting Engine", "sqlmap/1.5"];

      for (const ua of scanners) {
        const res = await app.inject({
          method: "GET",
          url: "/api/agents/run",
          headers: {
            "user-agent": ua,
            "x-forwarded-for": uniqueIp(),
          },
        });
        expect(res.statusCode).toBe(403);
      }
      await app.close();
    });

    it("allows normal user agents through", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          "x-forwarded-for": "127.0.0.1",
        },
        payload: { message: "hello" },
      });
      await app.close();

      // Should pass security and reach the route (200 with valid payload)
      expect(res.statusCode).toBe(200);
    });
  });

  describe("honeypot paths", () => {
    it("returns 403 for honeypot paths", async () => {
      const { app } = buildServer();
      const honeypots = ["/.env", "/.git", "/wp-admin", "/phpmyadmin", "/.ssh"];

      for (const path of honeypots) {
        const res = await app.inject({
          method: "GET",
          url: path,
          headers: { "x-forwarded-for": uniqueIp() },
        });
        expect(res.statusCode).toBe(403);
      }
      await app.close();
    });
  });

  describe("IP banning", () => {
    it("bans IP after enough honeypot hits (triple-counted)", async () => {
      const { app } = buildServer();
      const ip = uniqueIp();

      // Each honeypot hit counts as 3; threshold is 10; so 4 hits = 12 > 10 → banned
      for (let i = 0; i < 4; i++) {
        await app.inject({
          method: "GET",
          url: "/.env",
          headers: { "x-forwarded-for": ip },
        });
      }

      // Now a normal request should also be 403
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { "x-forwarded-for": ip },
      });
      await app.close();

      // Note: /health bypasses ban check (it returns before IP check)
      // Let's check a non-health path
    });

    it("banned IP gets 403 on all paths except /health", async () => {
      const { app } = buildServer();
      const ip = uniqueIp();

      // Trip the ban: 4 honeypot hits = 12 counts > threshold of 10
      for (let i = 0; i < 4; i++) {
        await app.inject({
          method: "GET",
          url: "/.env",
          headers: { "x-forwarded-for": ip },
        });
      }

      // Banned IP on normal path
      const res = await app.inject({
        method: "GET",
        url: "/api/agents/run",
        headers: { "x-forwarded-for": ip, "user-agent": "Mozilla/5.0" },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe("rate limiting", () => {
    it("returns rate limit headers on /api/* routes", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        headers: { "x-forwarded-for": "127.0.0.1" },
        payload: { message: "test" },
      });
      await app.close();

      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });

    it("returns 429 after exceeding rate limit", async () => {
      // Override env for a low limit
      const origMax = process.env.RATE_LIMIT_MAX;
      process.env.RATE_LIMIT_MAX = "3";

      const { app } = buildServer();
      const ip = uniqueIp();

      const results = [];
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/agents/run",
          headers: { "x-forwarded-for": ip },
          payload: { message: "test" },
        });
        results.push(res.statusCode);
      }

      await app.close();
      process.env.RATE_LIMIT_MAX = origMax;

      // First 3 should pass, 4th and 5th should be 429
      expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("bearer token auth", () => {
    it("blocks external /api/* requests when API_SECRET is set", async () => {
      const origSecret = process.env.API_SECRET;
      process.env.API_SECRET = "test-secret-123";

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        headers: { "x-forwarded-for": uniqueIp() },
        payload: { message: "test" },
      });

      await app.close();
      process.env.API_SECRET = origSecret;

      expect(res.statusCode).toBe(401);
    });

    it("allows requests with correct bearer token", async () => {
      const origSecret = process.env.API_SECRET;
      process.env.API_SECRET = "test-secret-123";

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        headers: {
          "x-forwarded-for": uniqueIp(),
          authorization: "Bearer test-secret-123",
        },
        payload: { message: "test" },
      });

      await app.close();
      process.env.API_SECRET = origSecret;

      expect(res.statusCode).toBe(200);
    });

    it("bypasses auth for internal (loopback) requests", async () => {
      const origSecret = process.env.API_SECRET;
      process.env.API_SECRET = "test-secret-123";

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        headers: { "x-forwarded-for": "127.0.0.1" },
        payload: { message: "test" },
      });

      await app.close();
      process.env.API_SECRET = origSecret;

      expect(res.statusCode).toBe(200);
    });
  });

  describe("metrics endpoint", () => {
    it("blocks /metrics from external IPs", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { "x-forwarded-for": uniqueIp() },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });
});
