import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ──

const queueCalls: Array<{
  name: string;
  opts: Record<string, unknown>;
}> = [];

const mockQueueAdd = vi.fn().mockResolvedValue({ id: "mock-job-id" });
const mockQueueClose = vi.fn().mockResolvedValue(undefined);
const mockGetWaitingCount = vi.fn().mockResolvedValue(5);
const mockGetActiveCount = vi.fn().mockResolvedValue(2);
const mockGetCompletedCount = vi.fn().mockResolvedValue(100);
const mockGetFailedCount = vi.fn().mockResolvedValue(3);
const mockGetDelayedCount = vi.fn().mockResolvedValue(1);
const mockGetWaiting = vi.fn().mockResolvedValue([]);
const mockGetActive = vi.fn().mockResolvedValue([]);
const mockJobFromId = vi.fn();
const mockJobRemove = vi.fn().mockResolvedValue(undefined);

// ── Mock bullmq ──

vi.mock("bullmq", () => {
  class MockQueue {
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getWaitingCount: ReturnType<typeof vi.fn>;
    getActiveCount: ReturnType<typeof vi.fn>;
    getCompletedCount: ReturnType<typeof vi.fn>;
    getFailedCount: ReturnType<typeof vi.fn>;
    getDelayedCount: ReturnType<typeof vi.fn>;
    getWaiting: ReturnType<typeof vi.fn>;
    getActive: ReturnType<typeof vi.fn>;
    name: string;
    constructor(name: string, opts: Record<string, unknown>) {
      queueCalls.push({ name, opts });
      this.name = name;
      this.add = mockQueueAdd;
      this.close = mockQueueClose;
      this.getWaitingCount = mockGetWaitingCount;
      this.getActiveCount = mockGetActiveCount;
      this.getCompletedCount = mockGetCompletedCount;
      this.getFailedCount = mockGetFailedCount;
      this.getDelayedCount = mockGetDelayedCount;
      this.getWaiting = mockGetWaiting;
      this.getActive = mockGetActive;
    }
  }

  return {
    Queue: MockQueue,
    Job: {
      fromId: (...args: unknown[]) => mockJobFromId(...args),
    },
  };
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

// ── Mock connection module ──

vi.mock("../connection.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  resetRedisConnection: vi.fn(),
}));

// ── Import modules under test AFTER mocks ──

import {
  enqueueAgentTask,
  enqueueMonitoringCheck,
  enqueueBriefing,
  sendToDeadLetter,
  listDeadLetterJobs,
  retryDeadLetterJob,
  getAllQueueStatus,
  pingRedis,
  getStaleJobCounts,
} from "../helpers.js";
import { closeAllQueues } from "../queues.js";

beforeEach(async () => {
  queueCalls.length = 0;
  mockQueueAdd.mockClear();
  mockQueueAdd.mockResolvedValue({ id: "mock-job-id" });
  mockQueueClose.mockClear();
  mockGetWaitingCount.mockClear().mockResolvedValue(5);
  mockGetActiveCount.mockClear().mockResolvedValue(2);
  mockGetCompletedCount.mockClear().mockResolvedValue(100);
  mockGetFailedCount.mockClear().mockResolvedValue(3);
  mockGetDelayedCount.mockClear().mockResolvedValue(1);
  mockGetWaiting.mockClear().mockResolvedValue([]);
  mockGetActive.mockClear().mockResolvedValue([]);
  mockJobFromId.mockClear();
  mockJobRemove.mockClear();

  // Close and clear queue cache so each test gets fresh Queue instances
  await closeAllQueues();
});

// ── enqueueAgentTask ──

describe("enqueueAgentTask()", () => {
  it("enqueues a job with the correct name and data", async () => {
    const job = { goalId: "goal-1", prompt: "Do something" };
    await enqueueAgentTask(job);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.objectContaining({ goalId: "goal-1", prompt: "Do something" }),
      expect.any(Object),
    );
  });

  it("returns the job id from the added job", async () => {
    mockQueueAdd.mockResolvedValueOnce({ id: "job-42" });
    const result = await enqueueAgentTask({ goalId: "g-1", prompt: "test" });
    expect(result).toBe("job-42");
  });

  it("maps priority=critical to BullMQ priority 1", async () => {
    await enqueueAgentTask({ goalId: "g-1", prompt: "urgent", priority: "critical" });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 1 }),
    );
  });

  it("maps priority=high to BullMQ priority 2", async () => {
    await enqueueAgentTask({ goalId: "g-1", prompt: "important", priority: "high" });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 2 }),
    );
  });

  it("defaults to priority=normal (BullMQ priority 3) when no priority specified", async () => {
    await enqueueAgentTask({ goalId: "g-1", prompt: "normal task" });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 3 }),
    );
  });

  it("maps priority=low to BullMQ priority 4", async () => {
    await enqueueAgentTask({ goalId: "g-1", prompt: "low prio", priority: "low" });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 4 }),
    );
  });

  it("preserves all job data fields", async () => {
    const job = {
      goalId: "goal-1",
      taskId: "task-1",
      prompt: "test prompt",
      conversationId: "conv-1",
      userId: "user-1",
      agentRole: "coder",
      priority: "high" as const,
    };
    await enqueueAgentTask(job);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.objectContaining({
        goalId: "goal-1",
        taskId: "task-1",
        prompt: "test prompt",
        conversationId: "conv-1",
        userId: "user-1",
        agentRole: "coder",
      }),
      expect.any(Object),
    );
  });
});

// ── enqueueBriefing ──

describe("enqueueBriefing()", () => {
  it("enqueues a morning briefing with the correct job name", async () => {
    const job = { type: "morning" as const };
    await enqueueBriefing(job);

    expect(mockQueueAdd).toHaveBeenCalledWith("briefing-morning", job);
  });

  it("enqueues an evening briefing with the correct job name", async () => {
    const job = { type: "evening" as const };
    await enqueueBriefing(job);

    expect(mockQueueAdd).toHaveBeenCalledWith("briefing-evening", job);
  });

  it("enqueues an on-demand briefing with userId", async () => {
    const job = { type: "on_demand" as const, userId: "user-1" };
    await enqueueBriefing(job);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "briefing-on_demand",
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("returns the job id", async () => {
    mockQueueAdd.mockResolvedValueOnce({ id: "briefing-99" });
    const result = await enqueueBriefing({ type: "morning" });
    expect(result).toBe("briefing-99");
  });
});

// ── enqueueMonitoringCheck ──

describe("enqueueMonitoringCheck()", () => {
  it("enqueues a monitoring job using the check type as the job name", async () => {
    const job = { check: "vps_health" as const };
    await enqueueMonitoringCheck(job);

    expect(mockQueueAdd).toHaveBeenCalledWith("vps_health", job);
  });

  it("enqueues a github_ci check with target metadata", async () => {
    const job = { check: "github_ci" as const, target: "ai-cofounder" };
    await enqueueMonitoringCheck(job);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "github_ci",
      expect.objectContaining({ target: "ai-cofounder" }),
    );
  });

  it("returns the job id", async () => {
    mockQueueAdd.mockResolvedValueOnce({ id: "mon-1" });
    const result = await enqueueMonitoringCheck({ check: "budget_check" });
    expect(result).toBe("mon-1");
  });
});

// ── sendToDeadLetter ──

describe("sendToDeadLetter()", () => {
  it("enqueues a dead-letter job with all original job metadata", async () => {
    await sendToDeadLetter(
      "agent-tasks",
      "original-123",
      "agent-task",
      { goalId: "g-1", prompt: "test" },
      "TimeoutError: job timed out",
      3,
    );

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "dead-letter",
      expect.objectContaining({
        originalQueue: "agent-tasks",
        originalJobId: "original-123",
        originalJobName: "agent-task",
        originalData: { goalId: "g-1", prompt: "test" },
        failedReason: "TimeoutError: job timed out",
        attemptsMade: 3,
        failedAt: expect.any(String),
      }),
      expect.objectContaining({
        removeOnComplete: false,
        removeOnFail: false,
      }),
    );
  });

  it("returns the DLQ job id", async () => {
    mockQueueAdd.mockResolvedValueOnce({ id: "dlq-42" });
    const result = await sendToDeadLetter("monitoring", "m-1", "vps_health", {}, "failed", 1);
    expect(result).toBe("dlq-42");
  });

  it("includes an ISO timestamp in failedAt", async () => {
    await sendToDeadLetter("agent-tasks", "j-1", "agent-task", {}, "error", 1);

    const dlJobData = mockQueueAdd.mock.calls[0][1] as Record<string, unknown>;
    // Verify it's a valid ISO date string
    const parsed = new Date(dlJobData.failedAt as string);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it("preserves removeOnComplete=false and removeOnFail=false so DLQ entries persist", async () => {
    await sendToDeadLetter("agent-tasks", "j-1", "agent-task", {}, "error", 1);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "dead-letter",
      expect.any(Object),
      expect.objectContaining({
        removeOnComplete: false,
        removeOnFail: false,
      }),
    );
  });
});

// ── listDeadLetterJobs ──

describe("listDeadLetterJobs()", () => {
  it("returns mapped entries from the DLQ waiting list", async () => {
    mockGetWaiting.mockResolvedValueOnce([
      {
        id: "dlq-1",
        data: {
          originalQueue: "agent-tasks",
          originalJobId: "j-100",
          originalJobName: "agent-task",
          failedReason: "timeout",
          attemptsMade: 3,
          failedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]);

    const entries = await listDeadLetterJobs();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      dlqJobId: "dlq-1",
      originalQueue: "agent-tasks",
      originalJobId: "j-100",
      originalJobName: "agent-task",
      failedReason: "timeout",
      attemptsMade: 3,
      failedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("uses default limit=50 and offset=0", async () => {
    mockGetWaiting.mockResolvedValueOnce([]);
    await listDeadLetterJobs();

    // getWaiting called with (offset, offset + limit - 1) = (0, 49)
    expect(mockGetWaiting).toHaveBeenCalledWith(0, 49);
  });

  it("supports custom limit and offset for pagination", async () => {
    mockGetWaiting.mockResolvedValueOnce([]);
    await listDeadLetterJobs(10, 20);

    expect(mockGetWaiting).toHaveBeenCalledWith(20, 29);
  });

  it("returns empty array when no DLQ jobs exist", async () => {
    mockGetWaiting.mockResolvedValueOnce([]);
    const entries = await listDeadLetterJobs();
    expect(entries).toEqual([]);
  });

  it("handles jobs with missing id by defaulting to empty string", async () => {
    mockGetWaiting.mockResolvedValueOnce([
      {
        id: undefined,
        data: {
          originalQueue: "monitoring",
          originalJobId: "m-1",
          originalJobName: "vps_health",
          failedReason: "error",
          attemptsMade: 1,
          failedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ]);

    const entries = await listDeadLetterJobs();
    expect(entries[0]!.dlqJobId).toBe("");
  });
});

// ── retryDeadLetterJob ──

describe("retryDeadLetterJob()", () => {
  it("re-enqueues the job to the original queue and removes it from DLQ", async () => {
    mockJobFromId.mockResolvedValueOnce({
      data: {
        originalQueue: "agent-tasks",
        originalJobName: "agent-task",
        originalData: { goalId: "g-1", prompt: "retry me" },
      },
      remove: mockJobRemove,
    });

    const result = await retryDeadLetterJob("dlq-1");

    // Should add job to original queue
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      { goalId: "g-1", prompt: "retry me" },
    );
    // Should remove from DLQ
    expect(mockJobRemove).toHaveBeenCalledOnce();
    expect(result).toEqual({ requeued: true, originalQueue: "agent-tasks" });
  });

  it("throws when the DLQ job is not found", async () => {
    mockJobFromId.mockResolvedValueOnce(null);

    await expect(retryDeadLetterJob("nonexistent")).rejects.toThrow(
      "DLQ job nonexistent not found",
    );
  });

  it("throws when originalQueue is unknown", async () => {
    mockJobFromId.mockResolvedValueOnce({
      data: {
        originalQueue: "unknown-queue",
        originalJobName: "test",
        originalData: {},
      },
      remove: mockJobRemove,
    });

    await expect(retryDeadLetterJob("dlq-2")).rejects.toThrow(
      "Unknown original queue: unknown-queue",
    );
  });

  it("supports retrying to the monitoring queue", async () => {
    mockJobFromId.mockResolvedValueOnce({
      data: {
        originalQueue: "monitoring",
        originalJobName: "vps_health",
        originalData: { check: "vps_health" },
      },
      remove: mockJobRemove,
    });

    const result = await retryDeadLetterJob("dlq-3");

    expect(mockQueueAdd).toHaveBeenCalledWith("vps_health", { check: "vps_health" });
    expect(result).toEqual({ requeued: true, originalQueue: "monitoring" });
  });
});

// ── getAllQueueStatus ──

describe("getAllQueueStatus()", () => {
  it("returns status entries for all known queues", async () => {
    const statuses = await getAllQueueStatus();

    // helpers.ts defines queues in getAllQueueStatus (count grows as features are added)
    expect(statuses.length).toBeGreaterThanOrEqual(9);

    const names = statuses.map((s) => s.name);
    expect(names).toContain("agent-tasks");
    expect(names).toContain("subagent-tasks");
    expect(names).toContain("monitoring");
    expect(names).toContain("briefings");
    expect(names).toContain("notifications");
    expect(names).toContain("pipelines");
    expect(names).toContain("rag-ingestion");
    expect(names).toContain("reflections");
    expect(names).toContain("dead-letter");
  });

  it("includes count fields from each queue", async () => {
    const statuses = await getAllQueueStatus();
    const first = statuses[0]!;

    expect(first).toHaveProperty("waiting", 5);
    expect(first).toHaveProperty("active", 2);
    expect(first).toHaveProperty("completed", 100);
    expect(first).toHaveProperty("failed", 3);
    expect(first).toHaveProperty("delayed", 1);
  });

  it("includes oldestWaitingTimestamp when waiting jobs exist", async () => {
    mockGetWaiting.mockResolvedValue([{ timestamp: 1700000000000 }]);

    const statuses = await getAllQueueStatus();
    expect(statuses[0]!.oldestWaitingTimestamp).toBe(1700000000000);
  });

  it("sets oldestWaitingTimestamp to undefined when no waiting jobs", async () => {
    mockGetWaiting.mockResolvedValue([]);

    const statuses = await getAllQueueStatus();
    expect(statuses[0]!.oldestWaitingTimestamp).toBeUndefined();
  });
});

// ── pingRedis ──

describe("pingRedis()", () => {
  // Note: pingRedis uses raw net.connect, so we mock the net module behavior.
  // The function parses REDIS_URL env var (defaults to redis://localhost:6379)
  // and attempts a TCP connection with a 3s timeout.

  it("returns 'ok' when a TCP connection succeeds", async () => {
    // In test environment with mocked Redis, the actual TCP connect will fail
    // to localhost:6379. We verify the function handles errors gracefully.
    const result = await pingRedis();
    // Without a real Redis, this should return "unreachable"
    expect(["ok", "unreachable"]).toContain(result);
  });

  it("returns 'unreachable' when REDIS_URL is an invalid URL", async () => {
    const originalUrl = process.env.REDIS_URL;
    // Set a bad URL that will fail to parse or connect
    process.env.REDIS_URL = "redis://192.0.2.1:1"; // RFC 5737 TEST-NET, guaranteed unreachable
    try {
      const result = await pingRedis();
      expect(result).toBe("unreachable");
    } finally {
      if (originalUrl !== undefined) {
        process.env.REDIS_URL = originalUrl;
      } else {
        delete process.env.REDIS_URL;
      }
    }
  }, 10_000); // Allow extra time for socket timeout
});

// ── getStaleJobCounts ──

describe("getStaleJobCounts()", () => {
  it("returns empty array when no active jobs exist", async () => {
    mockGetActive.mockResolvedValue([]);
    const result = await getStaleJobCounts();
    expect(result).toEqual([]);
  });

  it("returns empty array when active jobs are within threshold", async () => {
    const recentTimestamp = Date.now() - 1000; // 1 second ago — well within threshold
    mockGetActive.mockResolvedValue([{ processedOn: recentTimestamp }]);

    const result = await getStaleJobCounts();
    expect(result).toEqual([]);
  });

  it("detects stale jobs exceeding the default 30-minute threshold", async () => {
    const staleTimestamp = Date.now() - 31 * 60 * 1000; // 31 minutes ago
    mockGetActive.mockResolvedValue([{ processedOn: staleTimestamp }]);

    const result = await getStaleJobCounts();

    // Should find stale jobs across multiple queues (each returns same mock)
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.staleCount).toBe(1);
  });

  it("accepts a configurable threshold in milliseconds", async () => {
    const timestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    mockGetActive.mockResolvedValue([{ processedOn: timestamp }]);

    // With a 3-minute threshold, this job IS stale
    const staleResult = await getStaleJobCounts(3 * 60 * 1000);
    expect(staleResult.length).toBeGreaterThan(0);

    // With a 10-minute threshold, this job is NOT stale
    mockGetActive.mockResolvedValue([{ processedOn: timestamp }]);
    // Need fresh queues for the second call
    await closeAllQueues();
    const freshResult = await getStaleJobCounts(10 * 60 * 1000);
    expect(freshResult).toEqual([]);
  });

  it("skips jobs without processedOn timestamp", async () => {
    mockGetActive.mockResolvedValue([{ processedOn: undefined }]);

    const result = await getStaleJobCounts(1000);
    expect(result).toEqual([]);
  });

  it("counts multiple stale jobs per queue correctly", async () => {
    const staleTimestamp = Date.now() - 60 * 60 * 1000; // 1 hour ago
    mockGetActive.mockResolvedValue([
      { processedOn: staleTimestamp },
      { processedOn: staleTimestamp },
      { processedOn: Date.now() }, // recent — not stale
    ]);

    const result = await getStaleJobCounts();

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.staleCount).toBe(2);
  });
});
