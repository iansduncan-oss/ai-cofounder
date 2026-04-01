import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => `mock-${name}`,
}));

const mockListGoalBacklog = vi.fn().mockResolvedValue([]);
const mockListRecentWorkSessions = vi.fn().mockResolvedValue([]);
const mockGetGoal = vi.fn().mockResolvedValue(null);
const mockUpdateGoalMetadata = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listGoalBacklog: (...args: unknown[]) => mockListGoalBacklog(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  updateGoalMetadata: (...args: unknown[]) => mockUpdateGoalMetadata(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock" }],
    model: "test",
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

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-abc123");

vi.mock("@ai-cofounder/queue", () => ({
  enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
  enqueueSubagentTask: vi.fn(),
  getDeployVerificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
}));

const { buildServer } = await import("../server.js");

describe("GET /api/autonomous", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListGoalBacklog.mockResolvedValue([]);
    mockListRecentWorkSessions.mockResolvedValue([]);
    mockGetGoal.mockResolvedValue(null);
    mockUpdateGoalMetadata.mockResolvedValue({});
    mockEnqueueAgentTask.mockResolvedValue("job-abc123");
  });

  it("returns empty array when no backlog goals", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/autonomous" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
    await app.close();
  });

  it("returns backlog goals with count", async () => {
    const goals = [
      {
        id: "goal-1",
        title: "Build login page",
        description: "Create auth flow",
        status: "active",
        priority: "high",
        createdAt: "2026-03-10T10:00:00Z",
        updatedAt: "2026-03-10T12:00:00Z",
        taskCount: 3,
        pendingTaskCount: 2,
      },
      {
        id: "goal-2",
        title: "Fix dashboard bug",
        description: null,
        status: "active",
        priority: "critical",
        createdAt: "2026-03-09T08:00:00Z",
        updatedAt: "2026-03-10T11:00:00Z",
        taskCount: 1,
        pendingTaskCount: 1,
      },
    ];
    mockListGoalBacklog.mockResolvedValue(goals);
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/autonomous" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.count).toBe(2);
    expect(body.data[0].id).toBe("goal-1");
    expect(body.data[1].priority).toBe("critical");
    await app.close();
  });

  it("respects limit query param and clamps to max 20", async () => {
    mockListGoalBacklog.mockResolvedValue([]);
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/autonomous?limit=10" });
    expect(res.statusCode).toBe(200);
    expect(mockListGoalBacklog).toHaveBeenCalledWith(expect.anything(), 10);
    await app.close();
  });

  it("defaults limit to 5 when not provided", async () => {
    const { app } = buildServer();
    await app.inject({ method: "GET", url: "/api/autonomous" });
    expect(mockListGoalBacklog).toHaveBeenCalledWith(expect.anything(), 5);
    await app.close();
  });
});

describe("GET /api/autonomous/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRecentWorkSessions.mockResolvedValue([]);
  });

  it("returns empty array when no sessions", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/autonomous/sessions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
    await app.close();
  });

  it("returns recent sessions with data", async () => {
    const sessions = [
      {
        id: "ws-1",
        trigger: "schedule",
        status: "completed",
        summary: "Executed goal Build login page",
        tokensUsed: 5000,
        durationMs: 120000,
        actionsTaken: { goalId: "goal-1", goalTitle: "Build login page", actions: [] },
        createdAt: "2026-03-10T10:00:00Z",
      },
    ];
    mockListRecentWorkSessions.mockResolvedValue(sessions);
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/autonomous/sessions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    expect(body.data[0].trigger).toBe("schedule");
    await app.close();
  });

  it("defaults limit to 10", async () => {
    const { app } = buildServer();
    await app.inject({ method: "GET", url: "/api/autonomous/sessions" });
    expect(mockListRecentWorkSessions).toHaveBeenCalledWith(expect.anything(), 10);
    await app.close();
  });
});

describe("POST /api/autonomous/:goalId/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGoal.mockResolvedValue(null);
    mockUpdateGoalMetadata.mockResolvedValue({});
    mockEnqueueAgentTask.mockResolvedValue("job-abc123");
  });

  it("returns 404 when goal not found", async () => {
    mockGetGoal.mockResolvedValue(null);
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/autonomous/nonexistent-goal/run",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Goal not found");
    await app.close();
  });

  it("returns 202 with jobId when goal exists and job enqueued", async () => {
    mockGetGoal.mockResolvedValue({
      id: "goal-1",
      title: "Build auth",
      description: "Implement JWT auth",
      status: "active",
    });
    mockEnqueueAgentTask.mockResolvedValue("job-xyz789");
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/autonomous/goal-1/run",
      payload: { userId: "user-1" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBe("job-xyz789");
    expect(body.status).toBe("queued");
    expect(body.goalId).toBe("goal-1");
    await app.close();
  });

  it("stores queueJobId in goal metadata", async () => {
    mockGetGoal.mockResolvedValue({
      id: "goal-1",
      title: "Build auth",
      description: null,
      status: "active",
    });
    mockEnqueueAgentTask.mockResolvedValue("job-meta-test");
    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/autonomous/goal-1/run",
      payload: {},
    });
    expect(mockUpdateGoalMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "goal-1",
      expect.objectContaining({ queueJobId: "job-meta-test" }),
    );
    await app.close();
  });

  it("uses goal description as prompt when available", async () => {
    mockGetGoal.mockResolvedValue({
      id: "goal-1",
      title: "Build auth",
      description: "Implement JWT authentication with refresh tokens",
      status: "active",
    });
    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/autonomous/goal-1/run",
      payload: {},
    });
    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Implement JWT authentication with refresh tokens" }),
    );
    await app.close();
  });

  it("falls back to title as prompt when no description", async () => {
    mockGetGoal.mockResolvedValue({
      id: "goal-2",
      title: "Fix the bug",
      description: null,
      status: "active",
    });
    const { app } = buildServer();
    await app.inject({
      method: "POST",
      url: "/api/autonomous/goal-2/run",
      payload: {},
    });
    expect(mockEnqueueAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Fix the bug" }),
    );
    await app.close();
  });
});
