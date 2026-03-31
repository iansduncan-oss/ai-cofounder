import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
});

const mockCreateEvent = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createEvent: mockCreateEvent,
  markEventProcessed: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ key: "test" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
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
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  createN8nWorkflow: vi.fn(),
  updateN8nWorkflow: vi.fn(),
  getN8nWorkflow: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  deleteN8nWorkflow: vi.fn(),
  findN8nWorkflowByEvent: vi.fn(),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  updateWorkSession: vi.fn().mockResolvedValue({}),
  createSchedule: vi.fn().mockResolvedValue({ id: "sch-1" }),
  getSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleEnabled: vi.fn(),
  deleteSchedule: vi.fn(),
  recordLlmUsage: vi.fn(),
  getTodayTokenUsage: vi.fn().mockResolvedValue(0),
  touchMemory: vi.fn(),
  saveCodeExecution: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  listDueSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  countTasksByGoal: vi.fn().mockResolvedValue(0),
  countMemoriesByUser: vi.fn().mockResolvedValue(0),
  completeWorkSession: vi.fn(),
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

const TEST_WEBHOOK_SECRET = "test-webhook-secret";

function signPayload(payload: unknown): string {
  const body = JSON.stringify(payload);
  return "sha256=" + crypto.createHmac("sha256", TEST_WEBHOOK_SECRET).update(body).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
});

describe("GitHub webhook routes", () => {
  it("POST /api/webhooks/github — accepts push event", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "event-1",
      source: "github",
      type: "push",
      payload: {},
    });

    const payload = {
      ref: "refs/heads/main",
      commits: [{ id: "abc123", message: "fix bug" }],
      repository: { full_name: "user/repo" },
    };
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "push",
        "x-github-delivery": "delivery-123",
        "x-hub-signature-256": signPayload(payload),
      },
      payload,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("logged");
    expect(body.type).toBe("push");
    expect(body.summary).toContain("1 commit(s)");
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "github", type: "push" }),
    );
  });

  it("POST /api/webhooks/github — accepts pull_request event", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "event-2",
      source: "github",
      type: "pr_opened",
      payload: {},
    });

    const payload = {
      action: "opened",
      pull_request: { title: "Add feature X", number: 42 },
      repository: { full_name: "user/repo" },
    };
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-456",
        "x-hub-signature-256": signPayload(payload),
      },
      payload,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().type).toBe("pr_opened");
    expect(res.json().summary).toContain("Add feature X");
  });

  it("POST /api/webhooks/github — accepts issues event", async () => {
    mockCreateEvent.mockResolvedValueOnce({
      id: "event-3",
      source: "github",
      type: "issue_opened",
      payload: {},
    });

    const payload = {
      action: "opened",
      issue: { title: "Bug report", number: 10 },
      repository: { full_name: "user/repo" },
    };
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": signPayload(payload),
      },
      payload,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().type).toBe("issue_opened");
  });

  it("POST /api/webhooks/github — rejects invalid signature when secret is set", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "my-secret";

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=invalid",
      },
      payload: { ref: "refs/heads/main", commits: [], repository: { full_name: "user/repo" } },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid signature");
  });

  it("POST /api/webhooks/github — rejects missing signature when secret is set", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "my-secret";

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "push",
        // no x-hub-signature-256
      },
      payload: { ref: "refs/heads/main", commits: [], repository: { full_name: "user/repo" } },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Missing signature");
  });

  it("POST /api/webhooks/github — accepts valid signature", async () => {
    const secret = "test-secret";
    process.env.GITHUB_WEBHOOK_SECRET = secret;

    mockCreateEvent.mockResolvedValueOnce({
      id: "event-4",
      source: "github",
      type: "push",
      payload: {},
    });

    const payload = {
      ref: "refs/heads/main",
      commits: [{ id: "abc", message: "test" }],
      repository: { full_name: "user/repo" },
    };

    // Fastify serializes the body to JSON, so compute signature on the same
    const payloadStr = JSON.stringify(payload);
    const signature =
      "sha256=" + crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/github",
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      payload,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("logged");
  });
});
