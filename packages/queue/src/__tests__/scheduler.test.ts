import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);

vi.mock("bullmq", () => {
  class MockQueue {
    upsertJobScheduler = mockUpsertJobScheduler;
    add = vi.fn().mockResolvedValue({ id: "mock-job-id" });
    close = vi.fn().mockResolvedValue(undefined);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    constructor() {}
  }
  return { Queue: MockQueue, Worker: vi.fn(), Job: vi.fn() };
});

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

vi.mock("../connection.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  resetRedisConnection: vi.fn(),
}));

import { setupRecurringJobs } from "../scheduler.js";
import { closeAllQueues } from "../queues.js";

beforeEach(async () => {
  mockUpsertJobScheduler.mockClear();
  await closeAllQueues();
});

describe("setupRecurringJobs", () => {
  it("registers all recurring jobs", async () => {
    await setupRecurringJobs();

    // Count all upsertJobScheduler calls
    // Monitoring: github_ci, github_prs, vps_health, vps_containers, approval-timeout-sweep,
    //   budget-check, sandbox-orphan-cleanup, dlq-check, follow-up-reminders, self-healing-check
    // Briefing: morning-briefing, evening-briefing
    // Reflection: weekly-patterns, user-patterns, daily-pattern-feedback, weekly-memory-consolidation
    // RAG: recurring-conversation-sweep
    // Autonomous: recurring-autonomous-session
    // Meeting prep: meeting-prep-generate, meeting-prep-notify
    // Total: 10 + 2 + 4 + 1 + 1 + 2 = 20
    expect(mockUpsertJobScheduler.mock.calls.length).toBe(20);
  });

  it("registers 4 monitoring checks with correct interval", async () => {
    await setupRecurringJobs({ monitoringIntervalMinutes: 10 });

    const monitoringCalls = mockUpsertJobScheduler.mock.calls.filter(
      (call) => {
        const schedulerId = call[0] as string;
        return schedulerId.startsWith("recurring-") && ["recurring-github_ci", "recurring-github_prs", "recurring-vps_health", "recurring-vps_containers"].includes(schedulerId);
      },
    );

    expect(monitoringCalls).toHaveLength(4);
    for (const call of monitoringCalls) {
      expect(call[1]).toEqual({ every: 10 * 60 * 1000 });
    }
  });

  it("registers morning briefing with configurable hour and timezone", async () => {
    await setupRecurringJobs({ briefingHour: 7, briefingTimezone: "Europe/London" });

    const morningCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "morning-briefing",
    );

    expect(morningCall).toBeDefined();
    expect(morningCall![1]).toEqual({
      pattern: "0 7 * * *",
      tz: "Europe/London",
    });
    expect(morningCall![2]).toEqual({
      name: "morning-briefing",
      data: {
        type: "morning",
        deliveryChannels: ["slack", "discord"],
      },
    });
  });

  it("registers evening briefing at 6 PM", async () => {
    await setupRecurringJobs();

    const eveningCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "evening-briefing",
    );

    expect(eveningCall).toBeDefined();
    expect(eveningCall![1]).toMatchObject({ pattern: "0 18 * * *" });
    expect(eveningCall![2]).toMatchObject({
      name: "evening-briefing",
      data: { type: "evening" },
    });
  });

  it("registers weekly pattern extraction on Sunday 3 AM", async () => {
    await setupRecurringJobs();

    const weeklyCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "weekly-patterns",
    );

    expect(weeklyCall).toBeDefined();
    expect(weeklyCall![1]).toMatchObject({ pattern: "0 3 * * 0" });
    expect(weeklyCall![2]).toMatchObject({
      data: { action: "weekly_patterns" },
    });
  });

  it("registers user pattern analysis on Sunday 4 AM", async () => {
    await setupRecurringJobs();

    const userPatternCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "user-patterns",
    );

    expect(userPatternCall).toBeDefined();
    expect(userPatternCall![1]).toMatchObject({ pattern: "0 4 * * 0" });
    expect(userPatternCall![2]).toMatchObject({
      data: { action: "analyze_user_patterns" },
    });
  });

  it("registers daily pattern feedback at 2 AM", async () => {
    await setupRecurringJobs();

    const feedbackCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "daily-pattern-feedback",
    );

    expect(feedbackCall).toBeDefined();
    expect(feedbackCall![1]).toMatchObject({ pattern: "0 2 * * *" });
    expect(feedbackCall![2]).toMatchObject({
      data: { action: "process_pattern_feedback" },
    });
  });

  it("registers weekly memory consolidation on Sunday 4 AM", async () => {
    await setupRecurringJobs();

    const consolidationCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "weekly-memory-consolidation",
    );

    expect(consolidationCall).toBeDefined();
    expect(consolidationCall![1]).toMatchObject({ pattern: "0 4 * * 0" });
    expect(consolidationCall![2]).toMatchObject({
      data: { action: "consolidate_memories" },
    });
  });

  it("registers RAG conversation sweep every 6 hours", async () => {
    await setupRecurringJobs();

    const ragCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "recurring-conversation-sweep",
    );

    expect(ragCall).toBeDefined();
    expect(ragCall![1]).toEqual({ every: 6 * 60 * 60 * 1000 });
  });

  it("registers approval timeout sweep every 60s", async () => {
    await setupRecurringJobs();

    const approvalCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "approval-timeout-sweep",
    );

    expect(approvalCall).toBeDefined();
    expect(approvalCall![1]).toEqual({ every: 60_000 });
  });

  it("registers budget check every 60s", async () => {
    await setupRecurringJobs();

    const budgetCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "budget-check",
    );

    expect(budgetCall).toBeDefined();
    expect(budgetCall![1]).toEqual({ every: 60_000 });
  });

  it("registers meeting prep generation hourly", async () => {
    await setupRecurringJobs();

    const prepCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "meeting-prep-generate",
    );

    expect(prepCall).toBeDefined();
    expect(prepCall![1]).toMatchObject({ pattern: "0 * * * *" });
    expect(prepCall![2]).toMatchObject({
      data: { action: "generate_upcoming" },
    });
  });

  it("registers meeting prep notifications every 5 min", async () => {
    await setupRecurringJobs();

    const notifyCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "meeting-prep-notify",
    );

    expect(notifyCall).toBeDefined();
    expect(notifyCall![1]).toEqual({ every: 5 * 60 * 1000 });
    expect(notifyCall![2]).toMatchObject({
      data: { action: "send_notifications" },
    });
  });

  it("registers recurring autonomous session with configurable interval", async () => {
    await setupRecurringJobs({ autonomousSessionIntervalMinutes: 45 });

    const autoCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "recurring-autonomous-session",
    );

    expect(autoCall).toBeDefined();
    expect(autoCall![1]).toEqual({ every: 45 * 60 * 1000 });
    expect(autoCall![2]).toMatchObject({
      data: { trigger: "schedule" },
    });
  });

  it("uses default values when no options provided", async () => {
    await setupRecurringJobs();

    // Morning briefing defaults to hour=9, timezone=America/New_York
    const morningCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "morning-briefing",
    );
    expect(morningCall![1]).toEqual({
      pattern: "0 9 * * *",
      tz: "America/New_York",
    });

    // Monitoring defaults to 5 min
    const monitoringCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "recurring-github_ci",
    );
    expect(monitoringCall![1]).toEqual({ every: 5 * 60 * 1000 });
  });

  it("registers self-healing check every 15 minutes", async () => {
    await setupRecurringJobs();

    const healCall = mockUpsertJobScheduler.mock.calls.find(
      (call) => call[0] === "self-healing-check",
    );

    expect(healCall).toBeDefined();
    expect(healCall![1]).toEqual({ every: 15 * 60 * 1000 });
  });
});
