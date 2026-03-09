import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListActiveGoals = vi.fn();
const mockListRecentlyCompletedGoals = vi.fn();
const mockCountTasksByStatus = vi.fn();
const mockGetUsageSummary = vi.fn();
const mockListEnabledSchedules = vi.fn();
const mockListRecentWorkSessions = vi.fn();
const mockListPendingApprovals = vi.fn();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => new Proxy({
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) => mockListRecentlyCompletedGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  listEnabledSchedules: (...args: unknown[]) => mockListEnabledSchedules(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
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

const { gatherBriefingData, formatBriefing, sendDailyBriefing } = await import("../services/briefing.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Briefing service", () => {
  describe("gatherBriefingData", () => {
    it("aggregates data from all queries", async () => {
      mockListActiveGoals.mockResolvedValueOnce([
        { title: "Build MVP", priority: "high", taskCount: 5, completedTaskCount: 2, updatedAt: new Date() },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([{ title: "Setup CI" }]);
      mockCountTasksByStatus.mockResolvedValueOnce({ pending: 3, completed: 10, running: 1 });
      mockGetUsageSummary.mockResolvedValueOnce({ totalCostUsd: 1.25, requestCount: 50 });
      mockListEnabledSchedules.mockResolvedValueOnce([
        { description: "Daily backup", actionPrompt: "backup", nextRunAt: new Date() },
      ]);
      mockListRecentWorkSessions.mockResolvedValueOnce([
        { trigger: "schedule", status: "completed", summary: "Ran backup" },
      ]);
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.activeGoals).toHaveLength(1);
      expect(data.activeGoals[0].title).toBe("Build MVP");
      expect(data.activeGoals[0].progress).toBe("2/5 tasks");
      expect(data.completedYesterday).toHaveLength(1);
      expect(data.taskBreakdown).toEqual({ pending: 3, completed: 10, running: 1 });
      expect(data.costsSinceYesterday.totalCostUsd).toBe(1.25);
      expect(data.upcomingSchedules).toHaveLength(1);
      expect(data.recentSessions).toHaveLength(1);
    });

    it("handles goals with no tasks", async () => {
      mockListActiveGoals.mockResolvedValueOnce([
        { title: "New Goal", priority: "medium", taskCount: 0, completedTaskCount: 0, updatedAt: new Date() },
      ]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([]);
      mockCountTasksByStatus.mockResolvedValueOnce({});
      mockGetUsageSummary.mockResolvedValueOnce({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValueOnce([]);
      mockListRecentWorkSessions.mockResolvedValueOnce([]);
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const db = {} as any;
      const data = await gatherBriefingData(db);

      expect(data.activeGoals[0].progress).toBe("no tasks yet");
    });
  });

  describe("formatBriefing", () => {
    it("formats a complete briefing with all sections", () => {
      const text = formatBriefing({
        activeGoals: [
          { title: "Build API", priority: "high", progress: "2/4 tasks" },
          { title: "Deploy", priority: "critical", progress: "0/2 tasks" },
        ],
        completedYesterday: [{ title: "Fix bug" }],
        taskBreakdown: { pending: 3, completed: 10, running: 1 },
        costsSinceYesterday: { totalCostUsd: 1.25, requestCount: 50 },
        upcomingSchedules: [{ description: "Backup", nextRunAt: new Date("2026-01-01T08:00:00Z") }],
        recentSessions: [{ trigger: "schedule", status: "completed", summary: "Did stuff" }],
      });

      expect(text).toContain("Daily Briefing");
      expect(text).toContain("Active Goals (2)");
      expect(text).toContain("Build API");
      expect(text).toContain("!!"); // high priority
      expect(text).toContain("!!!"); // critical priority
      expect(text).toContain("Completed Yesterday (1)");
      expect(text).toContain("Fix bug");
      expect(text).toContain("14 total");
      expect(text).toContain("$1.25");
      expect(text).toContain("50 requests");
      expect(text).toContain("Upcoming Schedules");
      expect(text).toContain("Backup");
      expect(text).toContain("Recent Work Sessions");
      expect(text).toContain("Did stuff");
    });

    it("formats with no active goals", () => {
      const text = formatBriefing({
        activeGoals: [],
        completedYesterday: [],
        taskBreakdown: {},
        costsSinceYesterday: { totalCostUsd: 0, requestCount: 0 },
        upcomingSchedules: [],
        recentSessions: [],
      });

      expect(text).toContain("No active goals");
      expect(text).toContain("< $0.01");
    });

    it("truncates session summaries to 100 chars", () => {
      const longSummary = "A".repeat(200);
      const text = formatBriefing({
        activeGoals: [],
        completedYesterday: [],
        taskBreakdown: {},
        costsSinceYesterday: { totalCostUsd: 0, requestCount: 0 },
        upcomingSchedules: [],
        recentSessions: [{ trigger: "manual", status: "completed", summary: longSummary }],
      });

      // Should truncate to 100 chars
      expect(text).not.toContain("A".repeat(200));
      expect(text).toContain("A".repeat(100));
    });
  });

  describe("sendDailyBriefing", () => {
    it("generates briefing, formats it, and sends via notification service", async () => {
      mockListActiveGoals.mockResolvedValueOnce([]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([]);
      mockCountTasksByStatus.mockResolvedValueOnce({});
      mockGetUsageSummary.mockResolvedValueOnce({ totalCostUsd: 0, requestCount: 0 });
      mockListEnabledSchedules.mockResolvedValueOnce([]);
      mockListRecentWorkSessions.mockResolvedValueOnce([]);
      mockListPendingApprovals.mockResolvedValueOnce([]);

      const mockSendBriefing = vi.fn().mockResolvedValue(undefined);
      const notificationService = { sendBriefing: mockSendBriefing } as any;

      const db = {} as any;
      const result = await sendDailyBriefing(db, notificationService);

      expect(result).toContain("Daily Briefing");
      expect(mockSendBriefing).toHaveBeenCalledWith(expect.stringContaining("Daily Briefing"));
    });
  });
});
