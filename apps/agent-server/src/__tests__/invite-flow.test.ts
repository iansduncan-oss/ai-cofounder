import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
});

const mockFindAdminByEmail = vi.fn();
const mockCreateAdminUser = vi.fn();
const mockListAdminUsers = vi.fn();
const mockUpdateAdminRole = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]) }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  findAdminByEmail: (...args: unknown[]) => mockFindAdminByEmail(...args),
  findAdminById: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@test.com", role: "admin" }),
  createAdminUser: (...args: unknown[]) => mockCreateAdminUser(...args),
  countAdminUsers: vi.fn().mockResolvedValue(1),
  listAdminUsers: (...args: unknown[]) => mockListAdminUsers(...args),
  updateAdminRole: (...args: unknown[]) => mockUpdateAdminRole(...args),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversation: vi.fn().mockResolvedValue(null),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
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
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  recordLlmUsage: vi.fn(),
  recordToolExecution: vi.fn(),
  saveCodeExecution: vi.fn(),
  getAgentPerformanceStats: vi.fn().mockResolvedValue([]),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], model: "test", usage: { inputTokens: 1, outputTokens: 1 }, provider: "test" });
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    onCompletion = vi.fn();
    getCircuitBreakerStates = vi.fn().mockReturnValue([]);
    getTotalCost = vi.fn().mockReturnValue(0);
  }
  return { LlmRegistry: MockLlmRegistry, AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {},
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, defaultValue: string) => process.env[name] ?? defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

const { buildServer } = await import("../server.js");

function signToken(app: { jwt: { sign: (p: Record<string, unknown>, o?: Record<string, unknown>) => string } }, role: string, sub = "admin-1") {
  return app.jwt.sign({ sub, email: "admin@test.com", role }, { expiresIn: "15m" });
}

const EXT_IP = "203.0.113.1";

describe("Invite Flow", () => {
  beforeEach(() => {
    mockFindAdminByEmail.mockReset();
    mockCreateAdminUser.mockReset();
    mockListAdminUsers.mockReset();
    mockUpdateAdminRole.mockReset();
  });

  describe("POST /api/auth/invite", () => {
    it("admin can create an invite", async () => {
      const { app } = buildServer();
      await app.ready();
      mockFindAdminByEmail.mockResolvedValue(undefined);

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/invite",
        headers: { authorization: `Bearer ${signToken(app, "admin")}` },
        payload: { email: "new@test.com", role: "editor" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.link).toContain("/dashboard/register?token=");
      await app.close();
    });

    it("non-admin gets 403", async () => {
      const { app } = buildServer();
      await app.ready();

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/invite",
        headers: { authorization: `Bearer ${signToken(app, "editor")}` },
        payload: { email: "new@test.com", role: "editor" },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("rejects duplicate email", async () => {
      const { app } = buildServer();
      await app.ready();
      mockFindAdminByEmail.mockResolvedValue({ id: "existing", email: "new@test.com" });

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/invite",
        headers: { authorization: `Bearer ${signToken(app, "admin")}` },
        payload: { email: "new@test.com", role: "editor" },
      });

      expect(res.statusCode).toBe(409);
      await app.close();
    });
  });

  describe("POST /api/auth/register", () => {
    it("registers new user with valid invite token", async () => {
      const { app } = buildServer();
      await app.ready();
      const inviteToken = app.jwt.sign({ email: "new@test.com", role: "editor", type: "invite" }, { expiresIn: "7d" });
      mockFindAdminByEmail.mockResolvedValue(undefined);
      mockCreateAdminUser.mockResolvedValue({ id: "new-user", email: "new@test.com", role: "editor" });

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/register",
        payload: { token: inviteToken, password: "securepass123" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().accessToken).toBeDefined();
      expect(mockCreateAdminUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ email: "new@test.com", role: "editor" }),
      );
      await app.close();
    });

    it("rejects invalid/malformed token", async () => {
      const { app } = buildServer();
      await app.ready();

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/register",
        payload: { token: "invalid.token.value", password: "securepass123" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid");
      await app.close();
    });

    it("rejects non-invite token type", async () => {
      const { app } = buildServer();
      await app.ready();
      const refreshToken = app.jwt.sign({ sub: "admin-1", type: "refresh" }, { expiresIn: "7d" });

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "POST",
        url: "/api/auth/register",
        payload: { token: refreshToken, password: "securepass123" },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("User Management", () => {
    it("admin can list users", async () => {
      const { app } = buildServer();
      await app.ready();
      mockListAdminUsers.mockResolvedValue([{ id: "1", email: "a@test.com", role: "admin", createdAt: new Date() }]);

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "GET",
        url: "/api/auth/users",
        headers: { authorization: `Bearer ${signToken(app, "admin")}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().users).toHaveLength(1);
      await app.close();
    });

    it("admin can update user role", async () => {
      const { app } = buildServer();
      await app.ready();
      mockUpdateAdminRole.mockResolvedValue({ id: "user-2", email: "other@test.com", role: "viewer" });

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "PATCH",
        url: "/api/auth/users/user-2/role",
        headers: { authorization: `Bearer ${signToken(app, "admin")}` },
        payload: { role: "viewer" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.role).toBe("viewer");
      await app.close();
    });

    it("admin cannot demote self", async () => {
      const { app } = buildServer();
      await app.ready();

      const res = await app.inject({
        remoteAddress: EXT_IP,
        method: "PATCH",
        url: "/api/auth/users/admin-1/role",
        headers: { authorization: `Bearer ${signToken(app, "admin")}` },
        payload: { role: "viewer" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("demote");
      await app.close();
    });
  });
});
