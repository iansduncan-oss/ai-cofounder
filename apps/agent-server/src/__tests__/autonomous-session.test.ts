import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListActiveGoals = vi.fn().mockResolvedValue([]);
const mockListRecentWorkSessions = vi.fn().mockResolvedValue([]);
const mockCountTasksByStatus = vi.fn().mockResolvedValue({});
const mockCreateWorkSession = vi.fn().mockResolvedValue({ id: "ws-1" });
const mockCompleteWorkSession = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  createWorkSession: (...args: unknown[]) => mockCreateWorkSession(...args),
  completeWorkSession: (...args: unknown[]) => mockCompleteWorkSession(...args),
  // Unused but required by orchestrator transitive imports
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  createGoal: vi.fn().mockResolvedValue({ id: "g-1", title: "Test" }),
  createTask: vi.fn().mockResolvedValue({ id: "t-1", title: "Task", orderIndex: 0, assignedAgent: "researcher" }),
  updateGoalStatus: vi.fn(),
  createApproval: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  deleteSchedule: vi.fn(),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  listGoalBacklog: vi.fn().mockResolvedValue([]),
  getSystemDefaultWorkspace: vi.fn().mockResolvedValue({ id: "ws-default" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-auto" }),
  touchMemory: vi.fn().mockResolvedValue(undefined),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "I analyzed the goals and recommend focusing on..." }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 200 },
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
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: vi.fn((_name: string, defaultValue: string) => defaultValue),
  requireEnv: vi.fn().mockReturnValue("test"),
}));

const { runAutonomousSession } = await import("../autonomous-session.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
  // Re-set defaults after clearAllMocks
  mockListActiveGoals.mockResolvedValue([]);
  mockListRecentWorkSessions.mockResolvedValue([]);
  mockCountTasksByStatus.mockResolvedValue({});
  mockCreateWorkSession.mockResolvedValue({ id: "ws-1" });
  mockCompleteWorkSession.mockResolvedValue({});
});

describe("runAutonomousSession", () => {
  it("creates a work session record and completes it", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();

    const result = await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "manual",
    });

    expect(mockCreateWorkSession).toHaveBeenCalledWith(db, expect.objectContaining({
      trigger: "manual",
    }));
    expect(mockCompleteWorkSession).toHaveBeenCalledWith(
      db,
      "ws-1",
      expect.objectContaining({
        status: "completed",
      }),
    );
    expect(result.sessionId).toBe("ws-1");
    expect(result.status).toBe("completed");
  });

  it("returns token usage from the orchestrator", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();

    const result = await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "schedule",
    });

    expect(result.tokensUsed).toBe(300); // 100 + 200
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes prompt in context when provided", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();

    const result = await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "schedule",
      prompt: "Review all pending PRs",
    });

    expect(result.status).toBe("completed");
    expect(mockCreateWorkSession).toHaveBeenCalledWith(db, expect.objectContaining({
      context: expect.objectContaining({
        prompt: "Review all pending PRs",
      }),
    }));
  });

  it("passes scheduleId and eventId to the work session", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();

    await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "schedule",
      scheduleId: "sched-1",
      eventId: "evt-1",
    });

    expect(mockCreateWorkSession).toHaveBeenCalledWith(db, expect.objectContaining({
      scheduleId: "sched-1",
      eventId: "evt-1",
    }));
  });

  it("handles orchestrator failure gracefully", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    // Make the orchestrator throw
    (registry.complete as any).mockRejectedValueOnce(new Error("LLM provider error"));

    const result = await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "manual",
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("LLM provider error");
    expect(mockCompleteWorkSession).toHaveBeenCalledWith(
      db,
      "ws-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("gathers active goals context", async () => {
    mockListActiveGoals.mockResolvedValueOnce([
      { id: "g-1", title: "Build MVP", priority: "high", taskCount: 3, completedTaskCount: 1, updatedAt: new Date(), createdAt: new Date(), status: "active" },
    ]);

    const db = {} as any;
    const registry = new LlmRegistry();

    const result = await runAutonomousSession(db, registry, undefined, undefined, undefined, undefined, undefined, {
      trigger: "manual",
    });

    expect(result.status).toBe("completed");
    expect(mockListActiveGoals).toHaveBeenCalledWith(db);
  });
});
