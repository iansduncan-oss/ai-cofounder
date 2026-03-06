import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListActiveGoals = vi.fn();
const mockListRecentlyCompletedGoals = vi.fn();
const mockCountTasksByStatus = vi.fn();
const mockListPendingApprovals = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({}),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) => mockListRecentlyCompletedGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
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
  buildBriefingPrompt,
  buildFallbackBriefing,
  startScheduler,
} = await import("../scheduler.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: create mock briefing data
function makeBriefingData(overrides: Partial<Parameters<typeof buildBriefingPrompt>[0]> = {}) {
  return {
    activeGoals: [],
    recentlyCompleted: [],
    taskCounts: {} as Record<string, number>,
    pendingApprovals: [],
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
      mockListPendingApprovals.mockResolvedValueOnce([
        { id: "a-1", taskId: "t-1", status: "pending" },
      ]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.activeGoals).toHaveLength(1);
      expect(data.recentlyCompleted).toHaveLength(1);
      expect(data.taskCounts).toEqual({ pending: 2, completed: 5, running: 1 });
      expect(data.pendingApprovals).toHaveLength(1);
      expect(data.staleGoalCount).toBe(0); // updatedAt is "now", not stale
    });

    it("counts stale goals (24h+ since update)", async () => {
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      mockListActiveGoals.mockResolvedValueOnce([
        { id: "g-1", title: "Stale", updatedAt: staleDate, taskCount: 1, completedTaskCount: 0 },
        { id: "g-2", title: "Fresh", updatedAt: new Date(), taskCount: 1, completedTaskCount: 0 },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([]);
      mockCountTasksByStatus.mockResolvedValueOnce({});
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.staleGoalCount).toBe(1);
    });
  });

  describe("buildBriefingPrompt", () => {
    it("includes completed goals when present", () => {
      const data = makeBriefingData({
        recentlyCompleted: [{ id: "g-1", title: "Shipped Feature" } as any],
      });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("Shipped Feature");
      expect(prompt).toContain("Goals completed in last 24h");
    });

    it("notes when no goals completed", () => {
      const data = makeBriefingData();
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("No goals completed in the last 24 hours");
    });

    it("includes active goals with progress", () => {
      const data = makeBriefingData({
        activeGoals: [
          {
            id: "g-1",
            title: "Build API",
            priority: "high",
            updatedAt: new Date(),
            taskCount: 4,
            completedTaskCount: 2,
          } as any,
        ],
      });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("Build API");
      expect(prompt).toContain("2/4 tasks done");
    });

    it("marks stale goals", () => {
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const data = makeBriefingData({
        activeGoals: [
          {
            id: "g-1",
            title: "Forgotten",
            priority: "low",
            updatedAt: staleDate,
            taskCount: 1,
            completedTaskCount: 0,
          } as any,
        ],
      });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("[STALE]");
    });

    it("includes pending approvals count", () => {
      const data = makeBriefingData({
        pendingApprovals: [{ id: "a-1" } as any, { id: "a-2" } as any],
      });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("Pending approvals: 2");
    });

    it("includes task breakdown", () => {
      const data = makeBriefingData({
        taskCounts: { completed: 10, pending: 3, running: 1 },
      });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("14 total");
      expect(prompt).toContain("10 completed");
    });

    it("truncates to 5 active goals with overflow count", () => {
      const goals = Array.from({ length: 7 }, (_, i) => ({
        id: `g-${i}`,
        title: `Goal ${i}`,
        priority: "medium",
        updatedAt: new Date(),
        taskCount: 1,
        completedTaskCount: 0,
      }));
      const data = makeBriefingData({ activeGoals: goals as any });
      const prompt = buildBriefingPrompt(data);

      expect(prompt).toContain("... and 2 more");
    });
  });

  describe("buildFallbackBriefing", () => {
    it("produces a briefing with completed goals", () => {
      const data = makeBriefingData({
        recentlyCompleted: [{ id: "g-1", title: "Done Thing" } as any],
        activeGoals: [
          { id: "g-2", title: "Active", taskCount: 2, completedTaskCount: 1 } as any,
        ],
      });
      const text = buildFallbackBriefing(data);

      expect(text).toContain("Morning Briefing");
      expect(text).toContain("Done Thing");
      expect(text).toContain("Active");
    });

    it("shows stale goal count", () => {
      const data = makeBriefingData({ staleGoalCount: 3 });
      const text = buildFallbackBriefing(data);

      expect(text).toContain("3");
      expect(text).toContain("Stale");
    });

    it("shows pending approvals with /approve hint", () => {
      const data = makeBriefingData({
        pendingApprovals: [{ id: "a-1" } as any],
      });
      const text = buildFallbackBriefing(data);

      expect(text).toContain("/approve");
    });
  });

  describe("startScheduler", () => {
    it("does nothing when DISCORD_FOLLOWUP_WEBHOOK_URL is not set", () => {
      const origUrl = process.env.DISCORD_FOLLOWUP_WEBHOOK_URL;
      delete process.env.DISCORD_FOLLOWUP_WEBHOOK_URL;

      const registry = new LlmRegistry();
      const db = {} as any;

      // Should not throw
      startScheduler(db, registry);

      process.env.DISCORD_FOLLOWUP_WEBHOOK_URL = origUrl;
    });

    it("returns a SchedulerHandle with stop() when URL is set", () => {
      const origUrl = process.env.DISCORD_FOLLOWUP_WEBHOOK_URL;
      process.env.DISCORD_FOLLOWUP_WEBHOOK_URL = "https://discord.com/api/webhooks/test";

      const registry = new LlmRegistry();
      const db = {} as any;

      const handle = startScheduler(db, registry);
      expect(handle).toBeDefined();
      expect(typeof handle!.stop).toBe("function");

      // Clean up timers
      handle!.stop();
      process.env.DISCORD_FOLLOWUP_WEBHOOK_URL = origUrl;
    });

    it("returns undefined when URL is empty string", () => {
      const origUrl = process.env.DISCORD_FOLLOWUP_WEBHOOK_URL;
      process.env.DISCORD_FOLLOWUP_WEBHOOK_URL = "";

      const registry = new LlmRegistry();
      const db = {} as any;

      const handle = startScheduler(db, registry);
      expect(handle).toBeUndefined();

      process.env.DISCORD_FOLLOWUP_WEBHOOK_URL = origUrl;
    });
  });
});
