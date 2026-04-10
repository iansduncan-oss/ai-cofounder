import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { setupTestEnv, mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  setupTestEnv();
});

// ── Mock @ai-cofounder/shared ──
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Controllable DB mocks ──
const mockListActiveGoals = vi.fn().mockResolvedValue([]);
const mockListRecentlyCompletedGoals = vi.fn().mockResolvedValue([]);
const mockCountTasksByStatus = vi.fn().mockResolvedValue({});
const mockGetUsageSummary = vi.fn().mockResolvedValue({
  totalCostUsd: 0,
  requestCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  byProvider: {},
  byModel: {},
  byAgent: {},
});
const mockListEnabledSchedules = vi.fn().mockResolvedValue([]);
const mockListRecentWorkSessions = vi.fn().mockResolvedValue([]);
const mockListPendingApprovals = vi.fn().mockResolvedValue([]);
const mockUpsertBriefingCache = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) => mockListRecentlyCompletedGoals(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  listEnabledSchedules: (...args: unknown[]) => mockListEnabledSchedules(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  upsertBriefingCache: (...args: unknown[]) => mockUpsertBriefingCache(...args),
}));

// ── Mock @ai-cofounder/llm ──
const mockComplete = vi.fn();

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
  return { LlmRegistry: MockLlmRegistry };
});

// ── Mock discord-digest (dynamic import in sendDailyBriefing) ──
const mockDigestFlush = vi.fn().mockResolvedValue([]);

vi.mock("../services/discord-digest.js", () => ({
  DiscordDigestService: class {
    flush = mockDigestFlush;
  },
}));

// ── Import after mocks ──
const { gatherBriefingData, sendDailyBriefing } = await import(
  "../services/briefing.js"
);
import type { Db } from "@ai-cofounder/db";
import { LlmRegistry } from "@ai-cofounder/llm";

const mockDb = {} as Db;

// ── Notification service mock ──
const mockSendBriefing = vi.fn().mockResolvedValue(undefined);
const mockNotificationService = {
  sendBriefing: mockSendBriefing,
};

// ── Helpers ──
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function makeGoal(overrides: Partial<{ title: string; priority: string; taskCount: number; completedTaskCount: number; updatedAt: Date }> = {}) {
  return {
    title: overrides.title ?? "Test Goal",
    priority: overrides.priority ?? "medium",
    taskCount: overrides.taskCount ?? 3,
    completedTaskCount: overrides.completedTaskCount ?? 1,
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

describe("gatherBriefingData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveGoals.mockResolvedValue([]);
    mockListRecentlyCompletedGoals.mockResolvedValue([]);
    mockCountTasksByStatus.mockResolvedValue({});
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 1.25,
      requestCount: 42,
      totalInputTokens: 10000,
      totalOutputTokens: 5000,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
    mockListEnabledSchedules.mockResolvedValue([]);
    mockListRecentWorkSessions.mockResolvedValue([]);
    mockListPendingApprovals.mockResolvedValue([]);
  });

  it("returns all fields correctly with mock data", async () => {
    const now = new Date();
    mockListActiveGoals.mockResolvedValue([
      makeGoal({ title: "Build API", priority: "high", taskCount: 5, completedTaskCount: 2, updatedAt: now }),
    ]);
    mockListRecentlyCompletedGoals.mockResolvedValue([
      { title: "Fix login bug" },
    ]);
    mockCountTasksByStatus.mockResolvedValue({
      pending: 3,
      completed: 7,
      failed: 1,
    });
    mockListEnabledSchedules.mockResolvedValue([
      { description: "Daily backup", actionPrompt: "Run backup script", nextRunAt: new Date("2026-04-11T08:00:00Z") },
    ]);
    mockListRecentWorkSessions.mockResolvedValue([
      { trigger: "discord", status: "completed", summary: "Deployed v2.1" },
    ]);
    mockListPendingApprovals.mockResolvedValue([
      { id: "appr-1" },
      { id: "appr-2" },
    ]);

    const data = await gatherBriefingData(mockDb);

    // activeGoals
    expect(data.activeGoals).toHaveLength(1);
    expect(data.activeGoals[0].title).toBe("Build API");
    expect(data.activeGoals[0].priority).toBe("high");
    expect(data.activeGoals[0].progress).toBe("2/5 tasks");
    expect(data.activeGoals[0].hoursStale).toBeGreaterThanOrEqual(0);

    // completedYesterday
    expect(data.completedYesterday).toEqual([{ title: "Fix login bug" }]);

    // taskBreakdown
    expect(data.taskBreakdown).toEqual({ pending: 3, completed: 7, failed: 1 });

    // costs
    expect(data.costsSinceYesterday.totalCostUsd).toBe(1.25);
    expect(data.costsSinceYesterday.requestCount).toBe(42);

    // schedules
    expect(data.upcomingSchedules).toHaveLength(1);
    expect(data.upcomingSchedules[0].description).toBe("Daily backup");

    // sessions
    expect(data.recentSessions).toHaveLength(1);
    expect(data.recentSessions[0].trigger).toBe("discord");
    expect(data.recentSessions[0].status).toBe("completed");
    expect(data.recentSessions[0].summary).toBe("Deployed v2.1");

    // approvals & staleness
    expect(data.pendingApprovalCount).toBe(2);
    expect(data.staleGoalCount).toBe(0); // goal just updated
  });

  it("calculates staleness correctly (goal updated 72h ago gives hoursStale ~72)", async () => {
    mockListActiveGoals.mockResolvedValue([
      makeGoal({ title: "Stale goal", updatedAt: hoursAgo(72) }),
    ]);

    const data = await gatherBriefingData(mockDb);

    // Allow a margin of 1 hour for test execution time
    expect(data.activeGoals[0].hoursStale).toBeGreaterThanOrEqual(71);
    expect(data.activeGoals[0].hoursStale).toBeLessThanOrEqual(73);
  });

  it("counts stale goals (only those >= 48h)", async () => {
    mockListActiveGoals.mockResolvedValue([
      makeGoal({ title: "Fresh goal", updatedAt: hoursAgo(10) }),
      makeGoal({ title: "Borderline goal", updatedAt: hoursAgo(47) }),
      makeGoal({ title: "Stale goal A", updatedAt: hoursAgo(48) }),
      makeGoal({ title: "Stale goal B", updatedAt: hoursAgo(100) }),
    ]);

    const data = await gatherBriefingData(mockDb);

    expect(data.staleGoalCount).toBe(2);

    // Verify the fresh and borderline goals are not counted as stale
    const freshGoal = data.activeGoals.find((g) => g.title === "Fresh goal");
    expect(freshGoal!.hoursStale).toBeLessThan(48);

    const borderlineGoal = data.activeGoals.find((g) => g.title === "Borderline goal");
    expect(borderlineGoal!.hoursStale).toBeLessThan(48);
  });

  it("handles empty data (no goals, no sessions, no approvals)", async () => {
    // All mocks already return empty arrays/objects from beforeEach
    const data = await gatherBriefingData(mockDb);

    expect(data.activeGoals).toEqual([]);
    expect(data.completedYesterday).toEqual([]);
    expect(data.taskBreakdown).toEqual({});
    expect(data.costsSinceYesterday.totalCostUsd).toBe(1.25);
    expect(data.costsSinceYesterday.requestCount).toBe(42);
    expect(data.upcomingSchedules).toEqual([]);
    expect(data.recentSessions).toEqual([]);
    expect(data.pendingApprovalCount).toBe(0);
    expect(data.staleGoalCount).toBe(0);
  });

  it("defaults to 0 when getUsageSummary returns null", async () => {
    mockGetUsageSummary.mockResolvedValue(null);

    const data = await gatherBriefingData(mockDb);

    expect(data.costsSinceYesterday.totalCostUsd).toBe(0);
    expect(data.costsSinceYesterday.requestCount).toBe(0);
  });

  it("shows 'no tasks yet' when taskCount is 0", async () => {
    mockListActiveGoals.mockResolvedValue([
      makeGoal({ title: "Empty goal", taskCount: 0, completedTaskCount: 0 }),
    ]);

    const data = await gatherBriefingData(mockDb);

    expect(data.activeGoals[0].progress).toBe("no tasks yet");
  });

  it("uses actionPrompt slice when schedule has no description", async () => {
    mockListEnabledSchedules.mockResolvedValue([
      {
        description: null,
        actionPrompt: "This is a very long action prompt that should be truncated to 80 characters maximum for display purposes in the briefing",
        nextRunAt: null,
      },
    ]);

    const data = await gatherBriefingData(mockDb);

    // .slice(0, 80) produces exactly 80 characters
    expect(data.upcomingSchedules[0].description.length).toBe(80);
    expect(data.upcomingSchedules[0].description).toBe(
      "This is a very long action prompt that should be truncated to 80 characters maxi",
    );
  });

  it("limits schedules to 5", async () => {
    const schedules = Array.from({ length: 10 }, (_, i) => ({
      description: `Schedule ${i}`,
      actionPrompt: `action ${i}`,
      nextRunAt: null,
    }));
    mockListEnabledSchedules.mockResolvedValue(schedules);

    const data = await gatherBriefingData(mockDb);

    expect(data.upcomingSchedules).toHaveLength(5);
  });
});

describe("sendDailyBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up minimal data for gatherBriefingData
    mockListActiveGoals.mockResolvedValue([]);
    mockListRecentlyCompletedGoals.mockResolvedValue([]);
    mockCountTasksByStatus.mockResolvedValue({});
    mockGetUsageSummary.mockResolvedValue({ totalCostUsd: 0, requestCount: 0 });
    mockListEnabledSchedules.mockResolvedValue([]);
    mockListRecentWorkSessions.mockResolvedValue([]);
    mockListPendingApprovals.mockResolvedValue([]);
    mockUpsertBriefingCache.mockResolvedValue({});
  });

  it("calls LLM, sends notification, and caches result", async () => {
    const llmRegistry = new LlmRegistry();
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "Good morning, sir. All systems operational." }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
      provider: "test",
    });

    const result = await sendDailyBriefing(
      mockDb,
      mockNotificationService as any,  
      llmRegistry as any,  
    );

    // LLM was called
    expect(mockComplete).toHaveBeenCalledOnce();
    expect(mockComplete).toHaveBeenCalledWith(
      "simple",
      expect.objectContaining({
        system: expect.stringContaining("Jarvis"),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
        ]),
        max_tokens: 1024,
      }),
    );

    // Notification was sent
    expect(mockSendBriefing).toHaveBeenCalledOnce();
    expect(mockSendBriefing).toHaveBeenCalledWith(
      "Good morning, sir. All systems operational.",
    );

    // Result cached
    expect(mockUpsertBriefingCache).toHaveBeenCalledOnce();
    expect(mockUpsertBriefingCache).toHaveBeenCalledWith(
      mockDb,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // date string
      "Good morning, sir. All systems operational.",
    );

    // Return value matches
    expect(result).toBe("Good morning, sir. All systems operational.");
  });

  it("falls back to static format when LLM errors", async () => {
    const llmRegistry = new LlmRegistry();
    mockComplete.mockRejectedValue(new Error("LLM provider down"));

    const result = await sendDailyBriefing(
      mockDb,
      mockNotificationService as any,  
      llmRegistry as any,  
    );

    // Should still send a notification (with the static fallback)
    expect(mockSendBriefing).toHaveBeenCalledOnce();
    // Static format contains the greeting pattern
    expect(result).toMatch(/sir/i);

    // Should still cache the fallback text
    expect(mockUpsertBriefingCache).toHaveBeenCalledOnce();
  });

  it("uses static format when no llmRegistry is provided", async () => {
    const result = await sendDailyBriefing(
      mockDb,
      mockNotificationService as any,  
    );

    // LLM was NOT called
    expect(mockComplete).not.toHaveBeenCalled();

    // Notification was sent with the static formatted briefing
    expect(mockSendBriefing).toHaveBeenCalledOnce();
    expect(result).toMatch(/sir/i);

    // Still cached
    expect(mockUpsertBriefingCache).toHaveBeenCalledOnce();
  });

  it("handles cache write failure gracefully", async () => {
    mockUpsertBriefingCache.mockRejectedValue(new Error("DB write failed"));

    // Should not throw even when caching fails
    const result = await sendDailyBriefing(
      mockDb,
      mockNotificationService as any,  
    );

    expect(mockSendBriefing).toHaveBeenCalledOnce();
    expect(result).toBeTruthy();
  });
});
