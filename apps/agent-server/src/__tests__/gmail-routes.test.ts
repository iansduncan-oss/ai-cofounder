import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

// Mock GmailService
const mockListInbox = vi.fn();
const mockGetMessage = vi.fn();
const mockGetThread = vi.fn();
const mockSearchEmails = vi.fn();
const mockGetUnreadCount = vi.fn();
const mockCreateDraft = vi.fn();
const mockSendEmail = vi.fn();
const mockSendDraft = vi.fn();
const mockMarkAsRead = vi.fn();

vi.mock("../services/gmail.js", () => {
  return {
    GmailService: class MockGmailService {
      listInbox = mockListInbox;
      getMessage = mockGetMessage;
      getThread = mockGetThread;
      searchEmails = mockSearchEmails;
      getUnreadCount = mockGetUnreadCount;
      createDraft = mockCreateDraft;
      sendEmail = mockSendEmail;
      sendDraft = mockSendDraft;
      markAsRead = mockMarkAsRead;
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
    fatal: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => process.env[name] ?? `mock-${name}`,
}));

const { buildServer } = await import("../server.js");
const { app: serverApp } = buildServer();

const mockSummary = {
  id: "msg-1",
  threadId: "thread-1",
  from: "alice@example.com",
  to: "bob@example.com",
  subject: "Hello",
  snippet: "Hi there",
  date: "2026-03-18",
  isUnread: true,
  hasAttachments: false,
  labels: ["INBOX"],
};

const mockMessage = {
  ...mockSummary,
  cc: "",
  body: "Hi there, full body",
  bodyHtml: "<p>Hi there, full body</p>",
  attachments: [],
};

describe("Gmail routes", () => {
  const app = serverApp;

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /api/gmail/messages — returns inbox list", async () => {
    mockListInbox.mockResolvedValue([mockSummary]);
    const res = await app.inject({ method: "GET", url: "/api/gmail/messages" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].subject).toBe("Hello");
  });

  it("GET /api/gmail/messages/:id — returns full message", async () => {
    mockGetMessage.mockResolvedValue(mockMessage);
    const res = await app.inject({ method: "GET", url: "/api/gmail/messages/msg-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.body).toBe("Hi there, full body");
  });

  it("GET /api/gmail/threads/:id — returns thread", async () => {
    mockGetThread.mockResolvedValue({
      id: "thread-1",
      messages: [mockMessage],
      subject: "Hello",
      participants: ["alice@example.com", "bob@example.com"],
      messageCount: 1,
    });
    const res = await app.inject({ method: "GET", url: "/api/gmail/threads/thread-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(1);
  });

  it("GET /api/gmail/search — returns search results", async () => {
    mockSearchEmails.mockResolvedValue([mockSummary]);
    const res = await app.inject({ method: "GET", url: "/api/gmail/search?q=hello" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toHaveLength(1);
  });

  it("GET /api/gmail/search — returns 400 without query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/gmail/search" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/gmail/unread-count — returns count", async () => {
    mockGetUnreadCount.mockResolvedValue(5);
    const res = await app.inject({ method: "GET", url: "/api/gmail/unread-count" });
    expect(res.statusCode).toBe(200);
    expect(res.json().unreadCount).toBe(5);
  });

  it("POST /api/gmail/drafts — creates draft", async () => {
    mockCreateDraft.mockResolvedValue({ id: "draft-1", message: { id: "msg-2" } });
    const res = await app.inject({
      method: "POST",
      url: "/api/gmail/drafts",
      payload: { to: "bob@example.com", subject: "Test", body: "Draft body" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("draft-1");
  });

  it("POST /api/gmail/send — sends email", async () => {
    mockSendEmail.mockResolvedValue({ id: "msg-3", threadId: "thread-2" });
    const res = await app.inject({
      method: "POST",
      url: "/api/gmail/send",
      payload: { to: "bob@example.com", subject: "Test", body: "Email body" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("msg-3");
  });

  it("POST /api/gmail/drafts/:id/send — sends existing draft", async () => {
    mockSendDraft.mockResolvedValue({ id: "msg-4", threadId: "thread-3" });
    const res = await app.inject({
      method: "POST",
      url: "/api/gmail/drafts/draft-1/send",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("msg-4");
  });

  it("POST /api/gmail/messages/:id/read — marks read", async () => {
    mockMarkAsRead.mockResolvedValue(undefined);
    const res = await app.inject({
      method: "POST",
      url: "/api/gmail/messages/msg-1/read",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("returns 403 when Google account not connected", async () => {
    mockListInbox.mockRejectedValue(new Error("Google account not connected"));
    const res = await app.inject({ method: "GET", url: "/api/gmail/messages" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("Google account not connected");
  });
});
