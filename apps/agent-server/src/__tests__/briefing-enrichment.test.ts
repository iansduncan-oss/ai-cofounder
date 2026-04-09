import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// buildServer() tests need extra time on CI runners
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
  process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
  process.env.COOKIE_SECRET = "test-cookie-secret-32-chars-min!!";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "supersecret";
});

const mockGetBriefingCache = vi.fn().mockResolvedValue(null);
const mockUpsertBriefingCache = vi.fn().mockResolvedValue({});
const mockGetPrimaryAdminUserId = vi.fn().mockResolvedValue("admin-uuid-1");

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
  getBriefingCache: (...args: unknown[]) => mockGetBriefingCache(...args),
  upsertBriefingCache: (...args: unknown[]) => mockUpsertBriefingCache(...args),
  getPrimaryAdminUserId: (...args: unknown[]) => mockGetPrimaryAdminUserId(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
  sanitizeToolResult: (text: string) => text,
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

vi.mock("ioredis", () => {
  class MockRedis {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue(undefined);
    subscribe = vi.fn().mockResolvedValue(undefined);
    unsubscribe = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(0);
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue("OK");
    del = vi.fn().mockResolvedValue(1);
    status = "ready";
  }
  return { default: MockRedis };
});

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Mock briefing response" }],
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
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createLlmRegistry: () => new MockLlmRegistry(),
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

vi.mock("@ai-cofounder/rag", () => ({
  ingestText: vi.fn().mockResolvedValue(undefined),
  needsReingestion: vi.fn().mockResolvedValue(false),
  shouldSkipFile: vi.fn().mockReturnValue(false),
  ingestFiles: vi.fn().mockResolvedValue(undefined),
}));

const mockListEvents = vi.fn().mockResolvedValue([
  { id: "ev-1", summary: "Team standup", start: "2026-03-19T09:00:00Z", end: "2026-03-19T09:30:00Z", isAllDay: false, status: "confirmed", attendeeCount: 5 },
  { id: "ev-2", summary: "1:1 with Bob", start: "2026-03-19T14:00:00Z", end: "2026-03-19T14:30:00Z", isAllDay: false, status: "confirmed", attendeeCount: 2 },
]);
const mockGetUnreadCount = vi.fn().mockResolvedValue(8);
const mockListInbox = vi.fn().mockResolvedValue([
  { id: "m-1", threadId: "t-1", from: "alice@example.com", to: "me@example.com", subject: "Q1 Report", snippet: "Please review...", date: "2026-03-19", isUnread: true, hasAttachments: false, labels: [] },
]);

vi.mock("../services/calendar.js", () => ({
  CalendarService: class {
    listEvents = mockListEvents;
  },
}));

vi.mock("../services/gmail.js", () => ({
  GmailService: class {
    listInbox = mockListInbox;
    getUnreadCount = mockGetUnreadCount;
  },
}));

// Dynamic imports after mocks
const { enrichWithGoogle, formatBriefing, sendDailyBriefing } = await import("../services/briefing.js");
const { buildServer } = await import("../server.js");

const baseBriefingData = {
  activeGoals: [{ title: "Ship v2", priority: "high", progress: "3/5 tasks", hoursStale: 10 }],
  completedYesterday: [{ title: "Fix login bug" }],
  taskBreakdown: { completed: 3, pending: 2 },
  costsSinceYesterday: { totalCostUsd: 0.42, requestCount: 15 },
  upcomingSchedules: [],
  recentSessions: [],
  pendingApprovalCount: 0,
  staleGoalCount: 0,
};

describe("enrichWithGoogle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns calendar events and email data", async () => {
    const result = await enrichWithGoogle({} as never, "admin-uuid-1");
    expect(result).not.toBeNull();
    expect(result!.todayEvents).toHaveLength(2);
    expect(result!.todayEvents![0].summary).toBe("Team standup");
    expect(result!.unreadEmailCount).toBe(8);
    expect(result!.importantEmails).toHaveLength(1);
    expect(result!.importantEmails![0].subject).toBe("Q1 Report");
  });

  it("returns null when calendar service throws", async () => {
    mockListEvents.mockRejectedValueOnce(new Error("Google not connected"));
    const result = await enrichWithGoogle({} as never, "admin-uuid-1");
    expect(result).toBeNull();
  });
});

describe("formatBriefing with Google data", () => {
  it("includes today's schedule section", () => {
    const text = formatBriefing({
      ...baseBriefingData,
      todayEvents: [
        { summary: "Team standup", start: "2026-03-19T09:00:00Z", end: "2026-03-19T09:30:00Z", attendeeCount: 5 },
      ],
    });
    expect(text).toContain("Today's Schedule");
    expect(text).toContain("Team standup");
    expect(text).toContain("5 attendees");
  });

  it("includes email highlights section", () => {
    const text = formatBriefing({
      ...baseBriefingData,
      unreadEmailCount: 8,
      importantEmails: [
        { from: "alice@example.com", subject: "Q1 Report", snippet: "Please review" },
      ],
    });
    expect(text).toContain("8 unread");
    expect(text).toContain("alice@example.com");
    expect(text).toContain("Q1 Report");
  });

  it("omits Google sections when data absent", () => {
    const text = formatBriefing(baseBriefingData);
    expect(text).not.toContain("Today's Schedule");
    expect(text).not.toContain("Email:");
  });
});

describe("sendDailyBriefing with enrichment", () => {
  const mockNotificationService = {
    sendBriefing: vi.fn().mockResolvedValue(undefined),
    notifyGoalCompleted: vi.fn(),
    notifyApprovalNeeded: vi.fn(),
    notifyDlqAlert: vi.fn(),
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches with Google data when adminUserId provided", async () => {
    const text = await sendDailyBriefing({} as never, mockNotificationService, undefined, "admin-uuid-1");
    expect(mockListEvents).toHaveBeenCalled();
    expect(mockGetUnreadCount).toHaveBeenCalled();
    expect(mockUpsertBriefingCache).toHaveBeenCalled();
    expect(text).toBeTruthy();
  });

  it("works without adminUserId (no enrichment)", async () => {
    const text = await sendDailyBriefing({} as never, mockNotificationService);
    expect(mockListEvents).not.toHaveBeenCalled();
    expect(text).toBeTruthy();
  });

  it("caches the briefing text", async () => {
    await sendDailyBriefing({} as never, mockNotificationService);
    expect(mockUpsertBriefingCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.any(String),
    );
  });
});

describe("GET /api/briefings/today", () => {
  const { app } = buildServer();

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached briefing when available", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockGetBriefingCache.mockResolvedValueOnce({
      id: "bc-1",
      date: today,
      briefingText: "Cached briefing text",
      sections: { goals: "summary" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({ method: "GET", url: "/api/briefings/today" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(true);
    expect(body.text).toBe("Cached briefing text");
    expect(body.sections).toEqual({ goals: "summary" });
  });

  it("generates fresh briefing when refresh=true", async () => {
    const res = await app.inject({ method: "GET", url: "/api/briefings/today?refresh=true" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(false);
    // Should NOT have checked cache
    expect(mockGetBriefingCache).not.toHaveBeenCalled();
  });

  it("generates fresh briefing when no cache exists", async () => {
    mockGetBriefingCache.mockResolvedValueOnce(null);

    const res = await app.inject({ method: "GET", url: "/api/briefings/today" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(false);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
