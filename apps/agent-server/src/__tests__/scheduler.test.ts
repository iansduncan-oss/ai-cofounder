import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListActiveGoals = vi.fn();
const mockListRecentlyCompletedGoals = vi.fn();
const mockCountTasksByStatus = vi.fn();
const mockListPendingApprovals = vi.fn();
const mockGetUsageSummary = vi.fn();
const mockListEnabledSchedules = vi.fn();
const mockListRecentWorkSessions = vi.fn();
const mockListDueSchedules = vi.fn().mockResolvedValue([]);
const mockDecayAllMemoryImportance = vi.fn();
const mockGetTodayTokenTotal = vi.fn().mockResolvedValue(0);
const mockGetLatestUserMessageTime = vi.fn().mockResolvedValue(null);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => new Proxy({
  createDb: vi.fn().mockReturnValue({}),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) => mockListRecentlyCompletedGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  listEnabledSchedules: (...args: unknown[]) => mockListEnabledSchedules(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  listDueSchedules: (...args: unknown[]) => mockListDueSchedules(...args),
  decayAllMemoryImportance: (...args: unknown[]) => mockDecayAllMemoryImportance(...args),
  getTodayTokenTotal: (...args: unknown[]) => mockGetTodayTokenTotal(...args),
  getLatestUserMessageTime: (...args: unknown[]) => mockGetLatestUserMessageTime(...args),
  updateScheduleLastRun: vi.fn(),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}, {
    get(target: Record<string, unknown>, prop: string | symbol, receiver: unknown) {
      if (typeof prop === "string" && !(prop in target)) {
        const fn = vi.fn().mockResolvedValue(null);
        target[prop] = fn;
        return fn;
      }
      return Reflect.get(target, prop, receiver);
    },
    has() { return true; },
  }));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock briefing text" }],
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

const {
  gatherBriefingData,
  formatBriefing,
} = await import("../services/briefing.js");
const { startScheduler } = await import("../services/scheduler.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: create mock briefing data matching BriefingData interface
function makeBriefingData(overrides: Partial<Parameters<typeof formatBriefing>[0]> = {}) {
  return {
    activeGoals: [] as Array<{ title: string; priority: string; progress: string; hoursStale: number }>,
    completedYesterday: [] as Array<{ title: string }>,
    taskBreakdown: {} as Record<string, number>,
    costsSinceYesterday: { totalCostUsd: 0, requestCount: 0 },
    upcomingSchedules: [] as Array<{ description: string; nextRunAt: Date | null }>,
    recentSessions: [] as Array<{ trigger: string; status: string; summary: string | null }>,
    pendingApprovalCount: 0,
    staleGoalCount: 0,
    ...overrides,
  };
}

describe("Scheduler", () => {
  describe("gatherBriefingData", () => {
    it("aggregates data from all DB queries", async () => {
      const now = new Date();
      mockListActiveGoals.mockResolvedValueOnce([
        { id: "g-1", title: "Goal 1", priority: "high", updatedAt: now, taskCount: 3, completedTaskCount: 1 },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([
        { id: "g-2", title: "Done Goal" },
      ]);
      mockCountTasksByStatus.mockResolvedValueOnce({ pending: 2, completed: 5, running: 1 });
      mockGetUsageSummary.mockResolvedValueOnce({ totalCostUsd: 0.5, requestCount: 10 });
      mockListEnabledSchedules.mockResolvedValueOnce([]);
      mockListRecentWorkSessions.mockResolvedValueOnce([]);
      mockListPendingApprovals.mockResolvedValueOnce([
        { id: "a-1", taskId: "t-1", status: "pending" },
      ]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.activeGoals).toHaveLength(1);
      expect(data.completedYesterday).toHaveLength(1);
      expect(data.taskBreakdown).toEqual({ pending: 2, completed: 5, running: 1 });
      expect(data.pendingApprovalCount).toBe(1);
      expect(data.staleGoalCount).toBe(0); // updatedAt is "now", not stale
    });

    it("counts stale goals (48h+ since update)", async () => {
      const staleDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
      mockListActiveGoals.mockResolvedValueOnce([
        { id: "g-1", title: "Stale", updatedAt: staleDate, taskCount: 1, completedTaskCount: 0 },
        { id: "g-2", title: "Fresh", updatedAt: new Date(), taskCount: 1, completedTaskCount: 0 },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([]);
      mockCountTasksByStatus.mockResolvedValueOnce({});
      mockGetUsageSummary.mockResolvedValueOnce({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValueOnce([]);
      mockListRecentWorkSessions.mockResolvedValueOnce([]);
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.staleGoalCount).toBe(1);
    });
  });

  describe("formatBriefing", () => {
    it("includes completed goals when present", () => {
      const data = makeBriefingData({
        completedYesterday: [{ title: "Shipped Feature" }],
      });
      const text = formatBriefing(data);

      expect(text).toContain("Shipped Feature");
      expect(text).toContain("Completed Yesterday");
    });

    it("shows no active goals message when empty", () => {
      const data = makeBriefingData();
      const text = formatBriefing(data);

      expect(text).toContain("No active goals");
    });

    it("includes active goals with progress", () => {
      const data = makeBriefingData({
        activeGoals: [
          { title: "Build API", priority: "high", progress: "2/4 tasks", hoursStale: 0 },
        ],
      });
      const text = formatBriefing(data);

      expect(text).toContain("Build API");
      expect(text).toContain("2/4 tasks");
    });

    it("includes pending approvals count", () => {
      const data = makeBriefingData({
        pendingApprovalCount: 2,
      });
      const text = formatBriefing(data);

      expect(text).toContain("Pending Approvals");
      expect(text).toContain("2");
    });

    it("includes task breakdown", () => {
      const data = makeBriefingData({
        taskBreakdown: { completed: 10, pending: 3, running: 1 },
      });
      const text = formatBriefing(data);

      expect(text).toContain("14 total");
      expect(text).toContain("10 completed");
    });

    it("includes stale goal count", () => {
      const data = makeBriefingData({ staleGoalCount: 3 });
      const text = formatBriefing(data);

      expect(text).toContain("3");
      expect(text).toContain("Stale");
    });

    it("shows pending approvals with /approve hint", () => {
      const data = makeBriefingData({
        pendingApprovalCount: 1,
      });
      const text = formatBriefing(data);

      expect(text).toContain("/approve");
    });
  });

  describe("startScheduler", () => {
    it("returns a handle with stop()", () => {
      const registry = new LlmRegistry();
      const db = {} as any;

      const handle = startScheduler({
        db,
        llmRegistry: registry as any,
        n8nService: {} as any,
        sandboxService: {} as any,
        workspaceService: {} as any,
        pollIntervalMs: 60_000,
        briefingHour: 25, // impossible hour to prevent tick from consuming mocks
      });
      expect(handle).toBeDefined();
      expect(typeof handle.stop).toBe("function");

      // Clean up timers
      handle.stop();
    });

    it("stop() clears the interval", () => {
      const registry = new LlmRegistry();
      const db = {} as any;

      const handle = startScheduler({
        db,
        llmRegistry: registry as any,
        n8nService: {} as any,
        sandboxService: {} as any,
        workspaceService: {} as any,
        pollIntervalMs: 60_000,
        briefingHour: 25,
      });

      // Should not throw
      handle.stop();
    });
  });
});
