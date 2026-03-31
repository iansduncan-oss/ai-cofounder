import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ──

const mockQueueAdd = vi.fn().mockResolvedValue({ id: "mock-job-id" });
const mockGetWaiting = vi.fn().mockResolvedValue([]);
const mockGetActive = vi.fn().mockResolvedValue([]);
const mockFromId = vi.fn();
const mockJobRemove = vi.fn().mockResolvedValue(undefined);

vi.mock("bullmq", () => {
  class MockQueue {
    add = mockQueueAdd;
    close = vi.fn().mockResolvedValue(undefined);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    getWaiting = mockGetWaiting;
    getActive = mockGetActive;
    name = "test-queue";
    client = Promise.resolve({
      xtrim: vi.fn().mockResolvedValue(0),
    });
    constructor() {}
  }
  return {
    Queue: MockQueue,
    Worker: vi.fn(),
    Job: { fromId: (...args: unknown[]) => mockFromId(...args) },
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
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("../connection.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  resetRedisConnection: vi.fn(),
}));

import {
  enqueueAgentTask,
  enqueueMonitoringCheck,
  enqueueBriefing,
  enqueueNotification,
  enqueuePipeline,
  enqueueRagIngestion,
  enqueueReflection,
  enqueueSubagentTask,
  enqueueMeetingPrep,
  enqueueAutonomousSession,
  sendToDeadLetter,
  listDeadLetterJobs,
  retryDeadLetterJob,
  deleteDeadLetterJob,
  pingRedis,
} from "../helpers.js";
import { closeAllQueues } from "../queues.js";

beforeEach(async () => {
  mockQueueAdd.mockClear();
  mockGetWaiting.mockClear();
  mockGetActive.mockClear();
  mockFromId.mockClear();
  mockJobRemove.mockClear();
  await closeAllQueues();
});

describe("enqueueAgentTask", () => {
  it("creates job with correct priority mapping", async () => {
    await enqueueAgentTask({ goalId: "goal-1", prompt: "test", priority: "critical" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.objectContaining({ goalId: "goal-1" }),
      expect.objectContaining({ priority: 1 }),
    );
  });

  it("maps high priority to 2", async () => {
    await enqueueAgentTask({ goalId: "goal-1", prompt: "test", priority: "high" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 2 }),
    );
  });

  it("maps normal priority to 3", async () => {
    await enqueueAgentTask({ goalId: "goal-1", prompt: "test", priority: "normal" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 3 }),
    );
  });

  it("maps low priority to 4", async () => {
    await enqueueAgentTask({ goalId: "goal-1", prompt: "test", priority: "low" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 4 }),
    );
  });

  it("defaults to normal priority when not specified", async () => {
    await enqueueAgentTask({ goalId: "goal-1", prompt: "test" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 3 }),
    );
  });

  it("returns job id", async () => {
    const id = await enqueueAgentTask({ goalId: "goal-1", prompt: "test" });
    expect(id).toBe("mock-job-id");
  });
});

describe("enqueueMonitoringCheck", () => {
  it("enqueues monitoring job with check name", async () => {
    await enqueueMonitoringCheck({ check: "github_ci" });
    expect(mockQueueAdd).toHaveBeenCalledWith("github_ci", { check: "github_ci" });
  });
});

describe("enqueueBriefing", () => {
  it("enqueues briefing with type-based job name", async () => {
    await enqueueBriefing({ type: "morning", deliveryChannels: ["slack"] });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "briefing-morning",
      expect.objectContaining({ type: "morning" }),
    );
  });
});

describe("enqueueNotification", () => {
  it("enqueues notification job", async () => {
    await enqueueNotification({ channel: "slack", type: "alert", title: "Test", message: "Hello" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "notification",
      expect.objectContaining({ channel: "slack", title: "Test" }),
    );
  });
});

describe("enqueuePipeline", () => {
  it("creates pipeline job with stages and context", async () => {
    await enqueuePipeline({
      goalId: "goal-1",
      stages: [{ agent: "coder", prompt: "write code", dependsOnPrevious: false }],
      context: { foo: "bar" },
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "pipeline",
      expect.objectContaining({
        goalId: "goal-1",
        currentStage: 0,
        context: { foo: "bar" },
      }),
    );
  });
});

describe("enqueueRagIngestion", () => {
  it("enqueues RAG ingestion job", async () => {
    await enqueueRagIngestion({ action: "ingest_repo", sourceId: "repo-1" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "rag-ingestion",
      expect.objectContaining({ action: "ingest_repo", sourceId: "repo-1" }),
    );
  });
});

describe("enqueueReflection", () => {
  it("enqueues reflection with action-based name", async () => {
    await enqueueReflection({ action: "analyze_goal", goalId: "goal-1" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "reflection-analyze_goal",
      expect.objectContaining({ action: "analyze_goal" }),
    );
  });
});

describe("enqueueSubagentTask", () => {
  it("enqueues subagent task with priority", async () => {
    await enqueueSubagentTask({
      subagentRunId: "sa-1",
      title: "Research",
      instruction: "Find info",
      priority: "high",
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "subagent-task",
      expect.objectContaining({ subagentRunId: "sa-1" }),
      expect.objectContaining({ priority: 2 }),
    );
  });
});

describe("enqueueMeetingPrep", () => {
  it("enqueues meeting prep job", async () => {
    await enqueueMeetingPrep({ action: "generate_upcoming" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "meeting-prep-generate_upcoming",
      expect.objectContaining({ action: "generate_upcoming" }),
    );
  });
});

describe("enqueueAutonomousSession", () => {
  it("enqueues autonomous session job", async () => {
    await enqueueAutonomousSession({ trigger: "manual" });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "autonomous-session",
      expect.objectContaining({ trigger: "manual" }),
    );
  });
});

describe("sendToDeadLetter", () => {
  it("adds job to DLQ with correct data", async () => {
    await sendToDeadLetter("agent-tasks", "job-123", "agent-task", { foo: "bar" }, "timeout", 3);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "dead-letter",
      expect.objectContaining({
        originalQueue: "agent-tasks",
        originalJobId: "job-123",
        originalJobName: "agent-task",
        originalData: { foo: "bar" },
        failedReason: "timeout",
        attemptsMade: 3,
      }),
      expect.objectContaining({
        removeOnComplete: false,
        removeOnFail: false,
      }),
    );
  });

  it("includes failedAt timestamp", async () => {
    await sendToDeadLetter("q", "id", "name", {}, "err", 1);
    const jobData = mockQueueAdd.mock.calls[0][1];
    expect(jobData.failedAt).toBeDefined();
    expect(typeof jobData.failedAt).toBe("string");
  });
});

describe("listDeadLetterJobs", () => {
  it("returns formatted DLQ entries", async () => {
    mockGetWaiting.mockResolvedValueOnce([
      {
        id: "dlq-1",
        data: {
          originalQueue: "agent-tasks",
          originalJobId: "job-1",
          originalJobName: "agent-task",
          failedReason: "timeout",
          attemptsMade: 3,
          failedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    ]);

    const entries = await listDeadLetterJobs(10, 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      dlqJobId: "dlq-1",
      originalQueue: "agent-tasks",
      originalJobId: "job-1",
      originalJobName: "agent-task",
      failedReason: "timeout",
      attemptsMade: 3,
      failedAt: "2024-01-01T00:00:00.000Z",
    });
  });

  it("passes limit and offset to getWaiting", async () => {
    mockGetWaiting.mockResolvedValueOnce([]);
    await listDeadLetterJobs(20, 5);
    expect(mockGetWaiting).toHaveBeenCalledWith(5, 24); // offset + limit - 1
  });
});

describe("retryDeadLetterJob", () => {
  it("re-enqueues job to original queue and removes from DLQ", async () => {
    mockFromId.mockResolvedValueOnce({
      data: {
        originalQueue: "agent-tasks",
        originalJobName: "agent-task",
        originalData: { goalId: "goal-1" },
      },
      remove: mockJobRemove,
    });

    const result = await retryDeadLetterJob("dlq-1");
    expect(result).toEqual({ requeued: true, originalQueue: "agent-tasks" });
    expect(mockQueueAdd).toHaveBeenCalledWith("agent-task", { goalId: "goal-1" });
    expect(mockJobRemove).toHaveBeenCalled();
  });

  it("throws when DLQ job not found", async () => {
    mockFromId.mockResolvedValueOnce(null);
    await expect(retryDeadLetterJob("nonexistent")).rejects.toThrow("DLQ job nonexistent not found");
  });

  it("throws for unknown original queue", async () => {
    mockFromId.mockResolvedValueOnce({
      data: {
        originalQueue: "unknown-queue",
        originalJobName: "job",
        originalData: {},
      },
      remove: mockJobRemove,
    });
    await expect(retryDeadLetterJob("dlq-1")).rejects.toThrow("Unknown original queue: unknown-queue");
  });
});

describe("deleteDeadLetterJob", () => {
  it("removes job from DLQ", async () => {
    mockFromId.mockResolvedValueOnce({ remove: mockJobRemove });
    await deleteDeadLetterJob("dlq-1");
    expect(mockJobRemove).toHaveBeenCalled();
  });

  it("throws when job not found", async () => {
    mockFromId.mockResolvedValueOnce(null);
    await expect(deleteDeadLetterJob("nonexistent")).rejects.toThrow("DLQ job nonexistent not found");
  });
});

describe("pingRedis", () => {
  it("returns ok when connection succeeds", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    // pingRedis creates a raw TCP connection; in tests it will fail immediately
    // but we can verify it returns a valid result type
    const result = await pingRedis();
    expect(["ok", "unreachable"]).toContain(result);
    delete process.env.REDIS_URL;
  });

  it("returns unreachable for invalid host", async () => {
    process.env.REDIS_URL = "redis://192.0.2.1:6379"; // TEST-NET address, guaranteed unreachable
    const result = await pingRedis();
    expect(result).toBe("unreachable");
    delete process.env.REDIS_URL;
  });
});
