import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "supersecret";
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3100/api/auth/google/callback";
});

const mockFindAdminByEmail = vi.fn();
const mockCreateAdminUser = vi.fn();
const mockCountAdminUsers = vi.fn().mockResolvedValue(1);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  findAdminByEmail: (...args: unknown[]) => mockFindAdminByEmail(...args),
  createAdminUser: (...args: unknown[]) => mockCreateAdminUser(...args),
  countAdminUsers: (...args: unknown[]) => mockCountAdminUsers(...args),
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(false),
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
  },
  compare: vi.fn().mockResolvedValue(false),
  hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
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

const MOCK_OAUTH_ADMIN = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "oauth@example.com",
  passwordHash: null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCountAdminUsers.mockResolvedValue(1);
});

/* ────────────── GET /api/auth/google/client-id ────────────── */

describe("OAUTH-01: GET /api/auth/google/client-id", () => {
  it("returns clientId when Google OAuth is configured", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/client-id",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().clientId).toBe("test-google-client-id.apps.googleusercontent.com");
  });

  it("returns 404 when Google OAuth is not configured", async () => {
    const saved = {
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      uri: process.env.GOOGLE_REDIRECT_URI,
    };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/client-id",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Google OAuth not configured");

    // Restore
    process.env.GOOGLE_CLIENT_ID = saved.id;
    process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    process.env.GOOGLE_REDIRECT_URI = saved.uri;
  });
});

/* ────────────── GET /api/auth/google ────────────── */

describe("OAUTH-02: GET /api/auth/google", () => {
  it("redirects to Google OAuth URL with correct params", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("client_id=test-google-client-id.apps.googleusercontent.com");
    expect(location).toContain("redirect_uri=");
    expect(location).toContain("response_type=code");
    expect(location).toContain("scope=openid+email+profile");
    expect(location).toContain("state=");

    // Should set oauth_state cookie
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
    expect(cookieStr).toContain("oauth_state=");
  });

  it("returns 404 when Google OAuth not configured", async () => {
    const saved = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    process.env.GOOGLE_CLIENT_ID = saved;
  });
});

/* ────────────── GET /api/auth/google/callback ────────────── */

describe("OAUTH-03: GET /api/auth/google/callback", () => {
  it("redirects to login with error when OAuth error param is present", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?error=access_denied",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard/login?error=oauth_denied");
  });

  it("redirects to login when code is missing", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?state=some-state",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard/login?error=oauth_invalid");
  });

  it("redirects to login when state doesn't match cookie", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=test-code&state=wrong-state",
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: "oauth_state=correct-state",
      },
    });
    await app.close();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard/login?error=oauth_state_mismatch");
  });

  it("redirects to login when no oauth_state cookie is present", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=test-code&state=some-state",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard/login?error=oauth_state_mismatch");
  });

  it("completes OAuth flow with valid code, existing user", async () => {
    // Mock the Google token exchange + userinfo endpoints
    const mockFetch = vi.fn();

    // First call: token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "google-access-token" }),
    });

    // Second call: userinfo
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email: "admin@example.com" }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_ADMIN);

    const state = "test-state-uuid";

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=valid-code&state=${state}`,
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `oauth_state=${state}`,
      },
    });
    await app.close();

    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toMatch(/^\/dashboard\/auth\/callback#token=/);

    // Should set refresh cookie
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
    expect(cookieStr).toContain("refreshToken=");
  });

  it("creates new admin when email not found", async () => {
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "google-access-token" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email: "newuser@example.com" }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    mockFindAdminByEmail.mockResolvedValueOnce(undefined);
    mockCreateAdminUser.mockResolvedValueOnce({
      id: "new-admin-id",
      email: "newuser@example.com",
      passwordHash: null,
      createdAt: new Date(),
    });

    const state = "test-state-uuid-2";

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=valid-code&state=${state}`,
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `oauth_state=${state}`,
      },
    });
    await app.close();

    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(302);
    expect(res.headers.location as string).toMatch(/^\/dashboard\/auth\/callback#token=/);
    expect(mockCreateAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      { email: "newuser@example.com", passwordHash: null },
    );
  });

  it("redirects to login when Google token exchange fails", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "invalid_grant" }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    const state = "test-state-uuid-3";

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=bad-code&state=${state}`,
      headers: {
        "x-forwarded-for": "10.0.0.1",
        cookie: `oauth_state=${state}`,
      },
    });
    await app.close();

    globalThis.fetch = originalFetch;

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard/login?error=oauth_token_exchange");
  });
});

/* ────────────── Password login with OAuth-only user ────────────── */

describe("OAUTH-04: Password login rejects OAuth-only user", () => {
  it("returns 401 when admin has no passwordHash (OAuth-only)", async () => {
    mockFindAdminByEmail.mockResolvedValueOnce(MOCK_OAUTH_ADMIN);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "oauth@example.com", password: "anypassword" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid credentials");
  });
});
