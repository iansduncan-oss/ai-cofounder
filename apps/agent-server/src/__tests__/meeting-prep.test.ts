import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockGetMeetingPrep = vi.fn().mockResolvedValue(null);
const mockUpsertMeetingPrep = vi.fn().mockResolvedValue({});
const mockListUnnotifiedMeetingPreps = vi.fn().mockResolvedValue([]);
const mockMarkMeetingPrepNotified = vi.fn().mockResolvedValue(undefined);
const mockRecallMemories = vi.fn().mockResolvedValue([]);
const mockGetPrimaryAdminUserId = vi.fn().mockResolvedValue("admin-1");

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getMeetingPrep: (...args: unknown[]) => mockGetMeetingPrep(...args),
  upsertMeetingPrep: (...args: unknown[]) => mockUpsertMeetingPrep(...args),
  listUnnotifiedMeetingPreps: (...args: unknown[]) => mockListUnnotifiedMeetingPreps(...args),
  markMeetingPrepNotified: (...args: unknown[]) => mockMarkMeetingPrepNotified(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  getPrimaryAdminUserId: (...args: unknown[]) => mockGetPrimaryAdminUserId(...args),
}));

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Here are your meeting prep notes..." }],
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

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn(),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn(),
  closeAllQueues: vi.fn(),
  setupRecurringJobs: vi.fn(),
  enqueueAgentTask: vi.fn(),
  enqueueMeetingPrep: vi.fn(),
  goalChannel: vi.fn().mockReturnValue("goal:test"),
  pingRedis: vi.fn().mockResolvedValue("ok"),
}));

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
  ingestText: vi.fn(),
  ingestFiles: vi.fn(),
  needsReingestion: vi.fn().mockResolvedValue(false),
  shouldSkipFile: vi.fn().mockReturnValue(false),
}));

const mockListEvents = vi.fn().mockResolvedValue([]);
const mockGetEvent = vi.fn();

vi.mock("../services/calendar.js", () => ({
  CalendarService: class {
    listEvents = mockListEvents;
    getEvent = mockGetEvent;
  },
}));

vi.mock("../services/google-auth.js", () => ({
  getValidGoogleToken: vi.fn().mockResolvedValue("mock-token"),
  disconnectGoogle: vi.fn(),
  isGoogleConnected: vi.fn().mockResolvedValue(true),
  getGoogleConnectionStatus: vi.fn().mockResolvedValue({ connected: true }),
}));

describe("MeetingPrepService", () => {
  let MeetingPrepService: typeof import("../services/meeting-prep.js").MeetingPrepService;
  let LlmRegistry: typeof import("@ai-cofounder/llm").LlmRegistry;

  beforeAll(async () => {
    const mod = await import("../services/meeting-prep.js");
    MeetingPrepService = mod.MeetingPrepService;
    const llmMod = await import("@ai-cofounder/llm");
    LlmRegistry = llmMod.LlmRegistry;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
  });

  it("generateUpcomingPreps returns 0 when no events", async () => {
    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    const count = await svc.generateUpcomingPreps("admin-1");
    expect(count).toBe(0);
    expect(mockListEvents).toHaveBeenCalled();
  });

  it("generateUpcomingPreps skips events with existing prep", async () => {
    mockListEvents.mockResolvedValue([
      { id: "evt-1", summary: "Standup", start: "2026-03-20T10:00:00Z", end: "2026-03-20T10:30:00Z", isAllDay: false, status: "confirmed", attendeeCount: 3 },
    ]);
    mockGetMeetingPrep.mockResolvedValueOnce({ id: "prep-1", eventId: "evt-1" });

    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    const count = await svc.generateUpcomingPreps("admin-1");
    expect(count).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("generateUpcomingPreps generates prep for new events", async () => {
    mockListEvents.mockResolvedValue([
      { id: "evt-2", summary: "Sprint Review", start: "2026-03-20T14:00:00Z", end: "2026-03-20T15:00:00Z", isAllDay: false, status: "confirmed", attendeeCount: 5 },
    ]);
    mockGetMeetingPrep.mockResolvedValue(null);

    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    const count = await svc.generateUpcomingPreps("admin-1");
    expect(count).toBe(1);
    expect(mockComplete).toHaveBeenCalled();
    expect(mockUpsertMeetingPrep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: "evt-2", eventTitle: "Sprint Review" }),
    );
  });

  it("generatePrepForEvent recalls memories and calls LLM", async () => {
    mockRecallMemories.mockResolvedValueOnce([
      { key: "sprint-process", value: "We do 2-week sprints" },
    ]);

    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    await svc.generatePrepForEvent(
      { id: "evt-3", summary: "Planning", start: "2026-03-20T09:00:00Z", end: "2026-03-20T10:00:00Z", isAllDay: false, status: "confirmed", attendeeCount: 2 },
      "admin-1",
    );

    expect(mockRecallMemories).toHaveBeenCalled();
    expect(mockComplete).toHaveBeenCalled();
    const prompt = mockComplete.mock.calls[0][0][0].content;
    expect(prompt).toContain("Planning");
    expect(mockUpsertMeetingPrep).toHaveBeenCalled();
  });

  it("sendPrepNotifications sends for upcoming events and marks notified", async () => {
    mockListUnnotifiedMeetingPreps.mockResolvedValueOnce([
      { id: "prep-1", eventId: "evt-1", eventTitle: "Standup", eventStart: new Date(Date.now() + 15 * 60_000), prepText: "Prep notes here", notified: false },
    ]);

    const mockNotify = { sendBriefing: vi.fn().mockResolvedValue(undefined) };
    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    const count = await svc.sendPrepNotifications(mockNotify as never);

    expect(count).toBe(1);
    expect(mockNotify.sendBriefing).toHaveBeenCalledWith(expect.stringContaining("Standup"));
    expect(mockMarkMeetingPrepNotified).toHaveBeenCalledWith(expect.anything(), "prep-1");
  });

  it("sendPrepNotifications returns 0 when no preps due", async () => {
    const mockNotify = { sendBriefing: vi.fn() };
    const svc = new MeetingPrepService({} as never, new LlmRegistry());
    const count = await svc.sendPrepNotifications(mockNotify as never);
    expect(count).toBe(0);
    expect(mockNotify.sendBriefing).not.toHaveBeenCalled();
  });
});

describe("GET /api/calendar/events/:id/prep", () => {
  let buildServer: typeof import("../server.js").buildServer;
  let app: Awaited<ReturnType<typeof buildServer>>["app"];

  beforeAll(async () => {
    const mod = await import("../server.js");
    buildServer = mod.buildServer;
    const built = buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached prep when available", async () => {
    mockGetMeetingPrep.mockResolvedValueOnce({
      eventId: "evt-1",
      eventTitle: "Test Meeting",
      prepText: "Cached prep",
      attendees: null,
      relatedMemories: null,
      generatedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/calendar/events/evt-1/prep",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eventId).toBe("evt-1");
    expect(body.prepText).toBe("Cached prep");
  });

  it("generates on-demand when no cached prep", async () => {
    mockGetMeetingPrep
      .mockResolvedValueOnce(null) // first check
      .mockResolvedValueOnce({     // after generation
        eventId: "evt-2",
        eventTitle: "New Meeting",
        prepText: "Generated prep",
        attendees: null,
        relatedMemories: null,
        generatedAt: new Date().toISOString(),
      });

    mockGetEvent.mockResolvedValueOnce({
      id: "evt-2",
      summary: "New Meeting",
      start: { dateTime: "2026-03-20T10:00:00Z" },
      end: { dateTime: "2026-03-20T11:00:00Z" },
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event/evt-2",
      attendees: [],
      created: "2026-03-19T00:00:00Z",
      updated: "2026-03-19T00:00:00Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/calendar/events/evt-2/prep",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eventId).toBe("evt-2");
    expect(body.prepText).toBe("Generated prep");
  });

  it("refreshes when refresh=true", async () => {
    mockGetEvent.mockResolvedValueOnce({
      id: "evt-3",
      summary: "Refreshed Meeting",
      start: { dateTime: "2026-03-20T10:00:00Z" },
      end: { dateTime: "2026-03-20T11:00:00Z" },
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event/evt-3",
      attendees: [],
      created: "2026-03-19T00:00:00Z",
      updated: "2026-03-19T00:00:00Z",
    });

    mockGetMeetingPrep.mockResolvedValueOnce({
      eventId: "evt-3",
      eventTitle: "Refreshed Meeting",
      prepText: "Fresh prep",
      attendees: null,
      relatedMemories: null,
      generatedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/calendar/events/evt-3/prep?refresh=true",
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetEvent).toHaveBeenCalled(); // should have re-generated
  });
});
