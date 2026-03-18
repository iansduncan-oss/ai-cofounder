import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

// Mock CalendarService
const mockListEvents = vi.fn();
const mockGetEvent = vi.fn();
const mockSearchEvents = vi.fn();
const mockCreateEvent = vi.fn();
const mockUpdateEvent = vi.fn();
const mockDeleteEvent = vi.fn();
const mockRespondToEvent = vi.fn();
const mockGetFreeBusy = vi.fn();

vi.mock("../services/calendar.js", () => {
  return {
    CalendarService: class MockCalendarService {
      listEvents = mockListEvents;
      getEvent = mockGetEvent;
      searchEvents = mockSearchEvents;
      createEvent = mockCreateEvent;
      updateEvent = mockUpdateEvent;
      deleteEvent = mockDeleteEvent;
      respondToEvent = mockRespondToEvent;
      getFreeBusy = mockGetFreeBusy;
    },
  };
});

// Mock GmailService so it doesn't interfere
vi.mock("../services/gmail.js", () => {
  return {
    GmailService: class MockGmailService {
      listInbox = vi.fn().mockResolvedValue([]);
      getMessage = vi.fn();
      getThread = vi.fn();
      searchEmails = vi.fn().mockResolvedValue([]);
      getUnreadCount = vi.fn().mockResolvedValue(0);
      createDraft = vi.fn();
      sendEmail = vi.fn();
      sendDraft = vi.fn();
      markAsRead = vi.fn();
    },
  };
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  runMigrations: vi.fn().mockResolvedValue(undefined),
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
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createLlmRegistry: () => new MockLlmRegistry(),
  };
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

const { buildServer } = await import("../server.js");
const { app: serverApp } = buildServer();

const mockEventSummary = {
  id: "evt-1",
  summary: "Team Standup",
  start: "2026-03-18T09:00:00-04:00",
  end: "2026-03-18T09:30:00-04:00",
  isAllDay: false,
  location: "Room A",
  status: "confirmed",
  attendeeCount: 2,
};

const mockFullEvent = {
  id: "evt-1",
  summary: "Team Standup",
  description: "Daily standup",
  location: "Room A",
  start: { dateTime: "2026-03-18T09:00:00-04:00" },
  end: { dateTime: "2026-03-18T09:30:00-04:00" },
  status: "confirmed",
  htmlLink: "https://calendar.google.com/event?eid=abc",
  attendees: [{ email: "alice@example.com", responseStatus: "accepted", self: true }],
  organizer: { email: "alice@example.com", self: true },
  created: "2026-03-15T12:00:00Z",
  updated: "2026-03-15T12:00:00Z",
};

describe("Calendar routes", () => {
  const app = serverApp;

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/calendar/events — returns event list", async () => {
    mockListEvents.mockResolvedValue([mockEventSummary]);
    const res = await app.inject({ method: "GET", url: "/api/calendar/events" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].summary).toBe("Team Standup");
  });

  it("GET /api/calendar/events/search — returns search results", async () => {
    mockSearchEvents.mockResolvedValue([mockEventSummary]);
    const res = await app.inject({ method: "GET", url: "/api/calendar/events/search?q=standup" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
  });

  it("GET /api/calendar/events/search — returns 400 without query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/calendar/events/search" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/calendar/events/:id — returns full event", async () => {
    mockGetEvent.mockResolvedValue(mockFullEvent);
    const res = await app.inject({ method: "GET", url: "/api/calendar/events/evt-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toBe("Team Standup");
    expect(body.attendees).toHaveLength(1);
  });

  it("POST /api/calendar/events — creates event", async () => {
    mockCreateEvent.mockResolvedValue(mockFullEvent);
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events",
      payload: { summary: "Team Standup", start: "2026-03-18T09:00:00Z", end: "2026-03-18T09:30:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe("Team Standup");
  });

  it("POST /api/calendar/events — returns 400 without required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events",
      payload: { summary: "Missing times" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/calendar/events/:id — updates event", async () => {
    mockUpdateEvent.mockResolvedValue({ ...mockFullEvent, summary: "Updated" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/calendar/events/evt-1",
      payload: { summary: "Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe("Updated");
  });

  it("DELETE /api/calendar/events/:id — deletes event", async () => {
    mockDeleteEvent.mockResolvedValue(undefined);
    const res = await app.inject({ method: "DELETE", url: "/api/calendar/events/evt-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("POST /api/calendar/events/:id/respond — RSVPs to event", async () => {
    mockRespondToEvent.mockResolvedValue(mockFullEvent);
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events/evt-1/respond",
      payload: { responseStatus: "accepted" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("POST /api/calendar/events/:id/respond — returns 400 without responseStatus", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/events/evt-1/respond",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/calendar/free-busy — returns free/busy info", async () => {
    mockGetFreeBusy.mockResolvedValue({
      timeMin: "2026-03-18T00:00:00Z",
      timeMax: "2026-03-19T00:00:00Z",
      busy: [{ start: "2026-03-18T09:00:00Z", end: "2026-03-18T10:00:00Z" }],
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/free-busy",
      payload: { timeMin: "2026-03-18T00:00:00Z", timeMax: "2026-03-19T00:00:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().busy).toHaveLength(1);
  });

  it("POST /api/calendar/free-busy — returns 400 without required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/calendar/free-busy",
      payload: { timeMin: "2026-03-18T00:00:00Z" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 when Google account not connected", async () => {
    mockListEvents.mockRejectedValue(new Error("Google account not connected"));
    const res = await app.inject({ method: "GET", url: "/api/calendar/events" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("Google account not connected");
  });
});
