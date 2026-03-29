import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25"; // Prevent scheduler from consuming mocks
  // REDIS_URL must be set so pubsubPlugin uses the real path (with mocked Redis)
  // instead of the no-op stub, ensuring redisPubSub.getHistory is testable
  process.env.REDIS_URL = "redis://localhost:6379";
});

// --- Mock @ai-cofounder/shared ---
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (name: string, defaultValue: string) => {
    // Return REDIS_URL so pubsubPlugin takes the real (mocked) path instead of no-op
    const overrides: Record<string, string> = {
      REDIS_URL: "redis://localhost:6379",
    };
    return overrides[name] ?? defaultValue;
  },
  requireEnv: (name: string) => {
    const vals: Record<string, string> = {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    };
    if (vals[name]) return vals[name];
    throw new Error(`Missing required env: ${name}`);
  },
}));

// --- Mock @ai-cofounder/db ---
const mockGetGoal = vi.fn();
const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});
const mockCreateDb = vi.fn().mockReturnValue({
  execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: (...args: unknown[]) => mockCreateDb(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  createGoal: vi.fn().mockResolvedValue({ id: "goal-1" }),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  countGoalsByConversation: vi.fn().mockResolvedValue(0),
  updateGoalStatus: vi.fn().mockResolvedValue({}),
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
  saveMemory: vi.fn().mockResolvedValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  getConversation: vi.fn(),
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
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
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
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listRecentlyCompletedGoals: vi.fn().mockResolvedValue([]),
  decayAllMemoryImportance: vi.fn(),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  getLatestUserMessageTime: vi.fn().mockResolvedValue(null),
  getProviderHealthRecords: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn(),
  getProviderHealthHistory: vi.fn().mockResolvedValue([]),
  getToolStats: vi.fn().mockResolvedValue([]),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
  searchMessages: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listConversationsByUser: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  listDecisions: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getUsageSummary: vi.fn().mockResolvedValue({ totalCostUsd: 0, requestCount: 0 }),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
}));

// --- Mock @ai-cofounder/queue ---
const mockGetHistory = vi.fn().mockResolvedValue([]);
const _mockSubscribeGoal = vi.fn().mockResolvedValue(undefined);
const _mockUnsubscribeGoal = vi.fn().mockResolvedValue(undefined);
const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-123");
const mockSubscriberOn = vi.fn();
const mockSubscriberSubscribe = vi.fn().mockResolvedValue(undefined);
const mockSubscriberUnsubscribe = vi.fn().mockResolvedValue(undefined);
const mockSubscriberQuit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
  goalChannel: (goalId: string) => `agent-events:goal:${goalId}`,
  historyKey: (goalId: string) => `agent-events:history:${goalId}`,
  RedisPubSub: class {
    publish = vi.fn().mockResolvedValue(undefined);
    getHistory = mockGetHistory;
    close = vi.fn().mockResolvedValue(undefined);
  },
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: mockSubscriberSubscribe,
    unsubscribe: mockSubscriberUnsubscribe,
    on: mockSubscriberOn,
    quit: mockSubscriberQuit,
  }),
  CHANNEL_PREFIX: "agent-events:goal:",
  HISTORY_PREFIX: "agent-events:history:",
  HISTORY_TTL_SECONDS: 3600,
}));

// Mock ioredis to prevent real Redis connections (NOAUTH in CI/local)
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

// --- Mock @ai-cofounder/llm ---
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

// --- Mock dispatcher and verification (not used for SSE, but needed for server bootstrap) ---
vi.mock("../agents/dispatcher.js", () => ({
  TaskDispatcher: class {
    runGoal = vi.fn().mockResolvedValue({ status: "completed", tasks: [] });
    getProgress = vi.fn().mockResolvedValue({ status: "in_progress", tasks: [] });
  },
}));

vi.mock("../services/verification.js", () => ({
  VerificationService: class {
    verify = vi.fn().mockResolvedValue({});
  },
}));

const { buildServer } = await import("../server.js");

const GOAL_ID = "00000000-0000-0000-0000-000000000001";
const headers = { "x-forwarded-for": "10.0.1.50" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHistory.mockResolvedValue([]);
  mockEnqueueAgentTask.mockResolvedValue("job-123");
  mockUpdateGoalMetadata.mockResolvedValue({});
  mockSubscriberSubscribe.mockResolvedValue(undefined);
  mockSubscriberUnsubscribe.mockResolvedValue(undefined);
});

// ── Helper: parse SSE response body into data frames ──
function parseSseFrames(body: string): unknown[] {
  return body
    .split("\n\n")
    .filter((frame) => frame.trim().startsWith("data:"))
    .map((frame) => {
      const dataLine = frame.trim().replace(/^data:\s*/, "");
      return JSON.parse(dataLine);
    });
}

/* ──────────────────── SSE Stream Tests ──────────────────── */

describe("QUEUE-11: SSE endpoint replays history events on connect", () => {
  it("sends 3 progress events from history as data frames before terminal event", async () => {
    // History contains 3 progress events followed by a job_completed terminal event
    // so the stream closes cleanly and inject() can capture the full response body
    const historyWithTerminal = [
      {
        goalId: GOAL_ID,
        goalTitle: "Test Goal",
        taskId: "t-1",
        taskTitle: "Task 1",
        agent: "CoderAgent",
        status: "started",
        completedTasks: 0,
        totalTasks: 3,
        timestamp: 1000,
      },
      {
        goalId: GOAL_ID,
        goalTitle: "Test Goal",
        taskId: "t-1",
        taskTitle: "Task 1",
        agent: "CoderAgent",
        status: "completed",
        completedTasks: 1,
        totalTasks: 3,
        output: "Done",
        timestamp: 2000,
      },
      {
        goalId: GOAL_ID,
        goalTitle: "Test Goal",
        taskId: "t-2",
        taskTitle: "Task 2",
        agent: "ReviewerAgent",
        status: "started",
        completedTasks: 1,
        totalTasks: 3,
        timestamp: 3000,
      },
      {
        goalId: GOAL_ID,
        type: "job_completed",
        timestamp: 4000,
      },
    ];

    mockGetHistory.mockResolvedValueOnce(historyWithTerminal);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/execute/stream`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");

    const frames = parseSseFrames(res.body);
    // 3 progress frames + 1 terminal frame
    expect(frames).toHaveLength(4);
    expect(frames[0]).toMatchObject({ taskId: "t-1", status: "started" });
    expect(frames[1]).toMatchObject({ taskId: "t-1", status: "completed" });
    expect(frames[2]).toMatchObject({ taskId: "t-2", status: "started" });
    // Terminal frame has status: "completed"
    const terminalFrame = frames[3] as Record<string, unknown>;
    expect(terminalFrame.type).toBe("job_completed");
    expect(terminalFrame.status).toBe("completed");
  });
});

describe("QUEUE-11: SSE endpoint sends completed status and closes stream on job_completed in history", () => {
  it("sends progress events then completed lifecycle event, closes stream", async () => {
    const history = [
      {
        goalId: GOAL_ID,
        goalTitle: "Test Goal",
        taskId: "t-1",
        taskTitle: "Task 1",
        agent: "CoderAgent",
        status: "completed",
        completedTasks: 1,
        totalTasks: 1,
        timestamp: 1000,
      },
      {
        goalId: GOAL_ID,
        type: "job_completed",
        timestamp: 2000,
      },
    ];

    mockGetHistory.mockResolvedValueOnce(history);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/execute/stream`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);

    const frames = parseSseFrames(res.body);
    // First frame: progress event
    expect(frames[0]).toMatchObject({ taskId: "t-1", status: "completed" });
    // Last frame: lifecycle event with status: "completed"
    const lastFrame = frames[frames.length - 1] as Record<string, unknown>;
    expect(lastFrame.type).toBe("job_completed");
    expect(lastFrame.status).toBe("completed");
  });
});

describe("QUEUE-11: SSE endpoint sends failed status and closes stream on job_failed in history", () => {
  it("sends failed lifecycle event and closes stream", async () => {
    const history = [
      {
        goalId: GOAL_ID,
        type: "job_failed",
        timestamp: 2000,
        error: "Agent crashed",
      },
    ];

    mockGetHistory.mockResolvedValueOnce(history);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/execute/stream`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);

    const frames = parseSseFrames(res.body);
    expect(frames).toHaveLength(1);
    const lastFrame = frames[0] as Record<string, unknown>;
    expect(lastFrame.type).toBe("job_failed");
    expect(lastFrame.status).toBe("failed");
  });
});

describe("QUEUE-11: SSE endpoint returns empty replay when no history exists", () => {
  it("sends completed status after live job_completed event with empty initial history", async () => {
    // Empty history — job completes via live pub/sub event
    mockGetHistory.mockResolvedValueOnce([]);

    const { app } = buildServer();

    // Wait for plugins to fully register (including agentEvents decorator)
    await app.ready();

    const channel = `agent-events:goal:${GOAL_ID}`;

    // Schedule event emission after the handler has a chance to register its listener.
    // setImmediate fires after the current tick; since the SSE handler awaits getHistory
    // before subscribing, we use a small delay to allow the handler to register.
    setTimeout(() => {
      const completedEvent = JSON.stringify({
        goalId: GOAL_ID,
        type: "job_completed",
        timestamp: Date.now(),
      });
      app.agentEvents.emit(channel, completedEvent);
    }, 50);

    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/execute/stream`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    const frames = parseSseFrames(res.body);
    expect(frames).toHaveLength(1);
    const frame = frames[0] as Record<string, unknown>;
    expect(frame.type).toBe("job_completed");
    expect(frame.status).toBe("completed");
  });
});

describe("QUEUE-11: SSE response data frames use default message event (no event: field)", () => {
  it("does not include event: field prefix in response body", async () => {
    // Include a terminal event so the stream closes cleanly
    const historyWithTerminal = [
      {
        goalId: GOAL_ID,
        goalTitle: "Test Goal",
        taskId: "t-1",
        taskTitle: "Task 1",
        agent: "CoderAgent",
        status: "completed",
        completedTasks: 1,
        totalTasks: 1,
        timestamp: 1000,
      },
      {
        goalId: GOAL_ID,
        type: "job_completed",
        timestamp: 2000,
      },
    ];

    mockGetHistory.mockResolvedValueOnce(historyWithTerminal);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/execute/stream`,
      headers,
    });
    await app.close();

    // Must NOT contain "event:" field prefix — that would break useSSE's onmessage handler
    expect(res.body).not.toContain("event:");
    // Must contain "data:" prefix
    expect(res.body).toContain("data:");
  });
});

/* ──────────────────── Regression Tests ──────────────────── */

describe("QUEUE-02 regression: POST /:id/execute still returns 202", () => {
  it("returns 202 with jobId, status=queued, goalId", async () => {
    mockGetGoal.mockResolvedValueOnce({
      id: GOAL_ID,
      title: "Build MVP",
      description: "Build the minimum viable product",
      metadata: {},
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/goals/${GOAL_ID}/execute`,
      payload: { userId: "u-1" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBe("job-123");
    expect(body.status).toBe("queued");
    expect(body.goalId).toBe(GOAL_ID);
  });
});

describe("QUEUE-02 regression: GET /:id/progress still works", () => {
  it("returns progress data for a goal", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/goals/${GOAL_ID}/progress`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "in_progress" });
  });
});
