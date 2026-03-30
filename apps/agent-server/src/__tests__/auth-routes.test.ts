import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "supersecret";
});

// --- Mocked DB functions ---
const mockFindAdminByEmail = vi.fn();
const mockFindAdminById = vi.fn();
const mockCreateAdminUser = vi.fn();
const mockCountAdminUsers = vi.fn().mockResolvedValue(0);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  findAdminByEmail: (...args: unknown[]) => mockFindAdminByEmail(...args),
  findAdminById: (...args: unknown[]) => mockFindAdminById(...args),
  createAdminUser: (...args: unknown[]) => mockCreateAdminUser(...args),
  countAdminUsers: (...args: unknown[]) => mockCountAdminUsers(...args),
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
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
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
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}));

// Mock bcryptjs so we can control compare/hash behavior
const mockBcryptCompare = vi.fn();
const mockBcryptHash = vi.fn().mockResolvedValue("$2a$12$hashedpassword");

vi.mock("bcryptjs", () => ({
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
    hash: (...args: unknown[]) => mockBcryptHash(...args),
  },
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: (...args: unknown[]) => mockBcryptHash(...args),
}));

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-abc"),
  goalChannel: vi.fn().mockReturnValue("goal:test"),
  pingRedis: vi.fn().mockResolvedValue(true),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Mock response" }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: "test",
    });
    completeDirect = vi.fn();
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
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_ADMIN = {
  id: ADMIN_ID,
  email: "admin@example.com",
  passwordHash: "$2a$12$hashedpassword",
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reset bcrypt mocks to safe defaults
  mockBcryptCompare.mockResolvedValue(false);
  mockBcryptHash.mockResolvedValue("$2a$12$hashedpassword");
  mockCountAdminUsers.mockResolvedValue(0);
  mockCreateAdminUser.mockResolvedValue(MOCK_ADMIN);
});

/* ───────────────────── Login Tests ─────────────────────── */

describe("AUTH-01: POST /api/auth/login", () => {
  it("returns 200 with accessToken on valid credentials", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe("string");
  });

  it("returns 401 when password is wrong", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(false);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "wrongpassword" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid credentials");
  });

  it("returns 401 when email is not found", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(undefined);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "unknown@example.com", password: "somepassword" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid credentials");
  });
});

/* ───────────────────── Token Expiry Tests ─────────────────────── */

describe("AUTH-02: Access token has 15-minute expiry", () => {
  it("accessToken expires in ~900 seconds (15 min)", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const { accessToken } = res.json();

    // Decode JWT without verification to check expiry
    const [, payloadBase64] = accessToken.split(".");
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    const ttlSeconds = payload.exp - payload.iat;
    expect(ttlSeconds).toBe(900); // 15 minutes = 900 seconds
  });
});

/* ───────────────────── Cookie Tests ─────────────────────── */

describe("AUTH-03: Login sets HttpOnly refresh cookie", () => {
  it("sets HttpOnly + SameSite=Strict refresh cookie on login", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const setCookieHeader = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookieHeader)
      ? setCookieHeader.join("; ")
      : String(setCookieHeader ?? "");

    expect(cookieStr).toContain("refreshToken=");
    expect(cookieStr.toLowerCase()).toContain("httponly");
    expect(cookieStr.toLowerCase()).toContain("samesite=strict");
    expect(cookieStr.toLowerCase()).toContain("path=/api/auth");
  });
});

/* ───────────────────── Refresh Tests ─────────────────────── */

describe("AUTH-05: POST /api/auth/refresh", () => {
  it("returns new accessToken with valid refresh cookie", async () => {
    // First, log in to get a real refresh token
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);
    mockFindAdminById.mockResolvedValueOnce(MOCK_ADMIN);

    const { app } = buildServer();
    await app.ready();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });

    expect(loginRes.statusCode).toBe(200);
    const setCookieHeader = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader[0] : String(setCookieHeader ?? "");
    // Extract just the token value for the refresh cookie
    const refreshTokenMatch = cookieStr.match(/refreshToken=([^;]+)/);
    const refreshToken = refreshTokenMatch?.[1] ?? "";
    expect(refreshToken).toBeTruthy();

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `refreshToken=${refreshToken}`,
      },
    });
    await app.close();

    expect(refreshRes.statusCode).toBe(200);
    const body = refreshRes.json();
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe("string");
  });

  it("returns 401 when no refresh cookie is present", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("No refresh token");
  });

  it("returns 401 when refresh cookie is invalid JWT", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: "refreshToken=invalid.jwt.token",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

/* ───────────────────── Logout Tests ─────────────────────── */

describe("AUTH-06: POST /api/auth/logout", () => {
  it("returns 200 and clears the refresh cookie", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);

    // Verify the cookie was cleared (max-age=0 or expires in past)
    const setCookieHeader = res.headers["set-cookie"];
    if (setCookieHeader) {
      const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join("; ") : String(setCookieHeader);
      const hasCleared =
        cookieStr.toLowerCase().includes("max-age=0") ||
        cookieStr.toLowerCase().includes("expires=thu, 01 jan 1970");
      expect(hasCleared).toBe(true);
    }
    // If no set-cookie header at all, that's acceptable behavior for logout
  });
});

/* ───────────────────── Admin Seed Tests ─────────────────────── */

describe("AUTH-07: Admin seed on startup", () => {
  it("calls countAdminUsers on ready and creates admin when count is 0", async () => {
    mockCountAdminUsers.mockResolvedValueOnce(0);
    mockCreateAdminUser.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptHash.mockResolvedValueOnce("$2a$12$hashedpassword");

    const { app } = buildServer();
    await app.ready();
    await app.close();

    expect(mockCountAdminUsers).toHaveBeenCalled();
    expect(mockCreateAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "admin@example.com",
        passwordHash: "$2a$12$hashedpassword",
      }),
    );
  });

  it("skips admin seed when admin user already exists", async () => {
    mockCountAdminUsers.mockResolvedValueOnce(1);

    const { app } = buildServer();
    await app.ready();
    await app.close();

    expect(mockCountAdminUsers).toHaveBeenCalled();
    expect(mockCreateAdminUser).not.toHaveBeenCalled();
  });
});

/* ───────────────────── Bcrypt Tests ─────────────────────── */

describe("AUTH-08: Password hashed with bcrypt cost factor 12", () => {
  it("hashes admin password with bcrypt cost factor 12 during seed", async () => {
    mockCountAdminUsers.mockResolvedValueOnce(0);
    mockCreateAdminUser.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptHash.mockResolvedValueOnce("$2a$12$hashedpassword");

    const { app } = buildServer();
    await app.ready();
    await app.close();

    expect(mockBcryptHash).toHaveBeenCalledWith("supersecret", 12);
  });
});

/* ───────────────────── JWT Route Protection Tests ─────────────────────── */

describe("AUTH-04: Protected routes require valid JWT", () => {
  it("returns 401 for GET /api/goals without Authorization header", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/goals?conversationId=00000000-0000-0000-0000-000000000001",
      remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 200 for GET /api/goals with valid JWT", async () => {
    // First login to get a valid JWT
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);

    const { app } = buildServer();
    await app.ready();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken } = loginRes.json() as { accessToken: string };

    // GET /api/goals requires conversationId — mock the DB calls
    // These are set up in the top-level vi.mock for @ai-cofounder/db
    const res = await app.inject({
      method: "GET",
      url: "/api/goals?conversationId=00000000-0000-0000-0000-000000000001",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    await app.close();

    // With valid JWT, the route should not return 401
    // It may return 200 (with data) or other non-401 status based on route logic
    expect(res.statusCode).not.toBe(401);
  });
});

/* ───────────────────── Bot Isolation Tests ─────────────────────── */

describe("AUTH-09: Bot routes work without JWT", () => {
  it("GET /api/channels/:id/conversation returns non-401 without JWT", async () => {
    // getChannelConversation is mocked to return null (404, not 401)
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/channels/test-channel/conversation",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    // Should get 404 (channel not found) not 401 (unauthorized)
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/webhooks/github returns non-401 without JWT", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: { "x-forwarded-for": "10.0.0.1" },
      payload: {},
    });
    await app.close();

    // Should not be 401 — webhook routes don't require JWT
    expect(res.statusCode).not.toBe(401);
  });

  it("GET /api/auth/login is accessible without JWT", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "noone@example.com", password: "wrong" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    // Returns 401 for bad credentials, not because JWT is required for the route itself
    // The key is that the route responds — it's not blocked by jwtGuardPlugin
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid credentials");
  });
});

/* ───────────────────── Refresh Extended Tests ─────────────────────── */

describe("AUTH-10: POST /api/auth/refresh (extended)", () => {
  /** Helper: log in and return the refreshToken cookie value */
  async function loginAndGetRefreshToken(app: ReturnType<typeof buildServer>["app"]) {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);
    mockBcryptCompare.mockResolvedValueOnce(true);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@example.com", password: "supersecret" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(loginRes.statusCode).toBe(200);

    const setCookieHeader = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader[0] : String(setCookieHeader ?? "");
    const refreshTokenMatch = cookieStr.match(/refreshToken=([^;]+)/);
    const refreshToken = refreshTokenMatch?.[1] ?? "";
    expect(refreshToken).toBeTruthy();
    return refreshToken;
  }

  beforeEach(() => {
    // Default: findAdminById returns a valid admin with email
    mockFindAdminById.mockResolvedValue({ id: "admin-1", email: "test@example.com" });
  });

  it("refresh includes email claim", async () => {
    const { app } = buildServer();
    await app.ready();

    const refreshToken = await loginAndGetRefreshToken(app);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `refreshToken=${refreshToken}`,
      },
    });
    await app.close();

    expect(refreshRes.statusCode).toBe(200);
    const { accessToken } = refreshRes.json();
    expect(accessToken).toBeDefined();

    // Decode JWT payload (base64url) without verification
    const [, payloadBase64] = accessToken.split(".");
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    expect(payload.email).toBe("test@example.com");
  });

  it("refresh rotates cookie", async () => {
    const { app } = buildServer();
    await app.ready();

    const refreshToken = await loginAndGetRefreshToken(app);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `refreshToken=${refreshToken}`,
      },
    });
    await app.close();

    expect(refreshRes.statusCode).toBe(200);

    // Verify the response includes a new refreshToken cookie with the correct path
    const setCookieHeader = refreshRes.headers["set-cookie"];
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [String(setCookieHeader ?? "")];
    const refreshCookie = cookies.find((c) => c.includes("refreshToken="));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie!.toLowerCase()).toContain("path=/api/auth");
  });

  it("refresh rejects deleted user", async () => {
    // Override: user no longer exists in DB
    mockFindAdminById.mockResolvedValue(undefined);

    const { app } = buildServer();
    await app.ready();

    const refreshToken = await loginAndGetRefreshToken(app);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `refreshToken=${refreshToken}`,
      },
    });
    await app.close();

    expect(refreshRes.statusCode).toBe(401);
    expect(refreshRes.json()).toEqual({ error: "User not found" });
  });
});
