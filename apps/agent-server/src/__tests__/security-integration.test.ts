import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// Set env before any imports that read it
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

// --- Mocked DB ---
vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createEvent: vi.fn(),
}));

// --- Mocked queue ---
vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-abc"),
}));

// --- Mocked LLM ---
vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock response" }],
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
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

const { _resetSecurityState } = await import("../plugins/security.js");
const { buildServer } = await import("../server.js");

// Save original env values for cleanup
const originalApiSecret = process.env.API_SECRET;
const originalRateLimitMax = process.env.RATE_LIMIT_MAX;

beforeEach(() => {
  _resetSecurityState();
  vi.clearAllMocks();
  // Clean env between tests
  delete process.env.API_SECRET;
  delete process.env.RATE_LIMIT_MAX;
});

afterEach(() => {
  // Restore original env
  if (originalApiSecret !== undefined) {
    process.env.API_SECRET = originalApiSecret;
  } else {
    delete process.env.API_SECRET;
  }
  if (originalRateLimitMax !== undefined) {
    process.env.RATE_LIMIT_MAX = originalRateLimitMax;
  } else {
    delete process.env.RATE_LIMIT_MAX;
  }
});

/* ──────────────────── Health Endpoint ──────────────────── */

describe("Health endpoint bypasses security", () => {
  it("GET /health returns 200 even with a blocked user agent", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "user-agent": "zgrab/1.0" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });
});

/* ──────────────────── Blocked User Agents ──────────────────── */

describe("Blocked scanner user agents", () => {
  it("request with user-agent 'zgrab' gets 403", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/health-check-fake",
      headers: { "user-agent": "zgrab/1.0" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Forbidden");
  });
});

/* ──────────────────── Honeypot Paths ──────────────────── */

describe("Honeypot path blocking", () => {
  it("GET /.env returns 403", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/.env",
      headers: { "x-forwarded-for": "99.99.99.1" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Forbidden");
  });

  it("GET /.git returns 403", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/.git",
      headers: { "x-forwarded-for": "99.99.99.2" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Forbidden");
  });

  it("GET /wp-admin returns 403", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/wp-admin",
      headers: { "x-forwarded-for": "99.99.99.3" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Forbidden");
  });
});

/* ──────────────────── Honeypot 3x Ban Multiplier ──────────────────── */

describe("Honeypot hits count 3x toward IP ban", () => {
  it("after 4 honeypot hits (4*3=12 > 10), subsequent requests get 403", async () => {
    const { app } = buildServer();
    const ip = "88.88.88.88";
    const headers = { "x-forwarded-for": ip };

    // 4 honeypot hits = 12 hits (each counts 3x), exceeds threshold of 10
    for (let i = 0; i < 4; i++) {
      await app.inject({ method: "GET", url: "/.env", headers });
    }

    // Now a valid path should be blocked because the IP is banned
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers,
    });
    await app.close();

    // /health bypasses security checks, so we need to test on a non-health path
    // Re-test with a regular path
    const { app: app2 } = buildServer();
    // The ban state is module-level, so it persists across server instances
    const res2 = await app2.inject({
      method: "GET",
      url: "/api/some-path",
      headers,
    });
    await app2.close();

    expect(res2.statusCode).toBe(403);
    expect(res2.json().error).toBe("Forbidden");
  });
});

/* ──────────────────── 404 Hit Accumulation Ban ──────────────────── */

describe("404 hits accumulate toward IP ban", () => {
  it("after 10 requests to non-existent paths, next request gets 403", async () => {
    const { app } = buildServer();
    const ip = "77.77.77.77";
    const headers = { "x-forwarded-for": ip };

    // Make 10 requests to non-existent paths (each triggers a 404 → recordHit)
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "GET",
        url: `/api/nonexistent-${i}`,
        headers,
      });
    }

    // 11th request should be banned
    const res = await app.inject({
      method: "GET",
      url: "/api/anything",
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("Forbidden");
  });
});

/* ──────────────────── Rate Limiting ──────────────────── */

describe("Rate limiting", () => {
  it("returns 429 after exceeding RATE_LIMIT_MAX", async () => {
    process.env.RATE_LIMIT_MAX = "5";
    const { app } = buildServer();
    const ip = "66.66.66.66";
    const headers = { "x-forwarded-for": ip };

    // Make 5 requests (within the limit)
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "GET",
        url: "/api/health",
        headers,
      });
    }

    // 6th request should be rate limited
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error).toBe("Too many requests");
    expect(body.retryAfter).toBeDefined();
    expect(typeof body.retryAfter).toBe("number");
  });
});

/* ──────────────────── API_SECRET Auth ──────────────────── */

describe("API_SECRET bearer token auth", () => {
  it("requests without Bearer header get 401 when API_SECRET is set", async () => {
    process.env.API_SECRET = "test-secret";
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-forwarded-for": "55.55.55.55" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Unauthorized");
  });

  it("requests with correct Bearer token pass through", async () => {
    process.env.API_SECRET = "test-secret";
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        "x-forwarded-for": "55.55.55.55",
        authorization: "Bearer test-secret",
      },
    });
    await app.close();

    // Should pass auth — a 200 or 404 depending on route existence, but NOT 401
    expect(res.statusCode).not.toBe(401);
  });
});

/* ──────────────────── Rate Limit Headers ──────────────────── */

describe("Rate limit headers", () => {
  it("includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-forwarded-for": "44.44.44.44" },
    });
    await app.close();

    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });
});
