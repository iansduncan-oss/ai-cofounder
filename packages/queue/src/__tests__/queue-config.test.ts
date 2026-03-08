import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ──
// Arrays are module-level so they persist across mock factory re-invocations.

const workerCalls: Array<{
  queueName: string;
  opts: Record<string, unknown>;
}> = [];

const queueCalls: Array<{
  name: string;
  opts: Record<string, unknown>;
}> = [];

const mockQueueAdd = vi.fn().mockResolvedValue({ id: "mock-job-id" });
const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockQueueClose = vi.fn().mockResolvedValue(undefined);

// ── Mock bullmq with class-compatible mocks ──

vi.mock("bullmq", () => {
  class MockWorker {
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    constructor(queueName: string, _processor: unknown, opts: Record<string, unknown>) {
      workerCalls.push({ queueName, opts });
      this.on = mockWorkerOn;
      this.close = mockWorkerClose;
    }
  }

  class MockQueue {
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getWaitingCount: ReturnType<typeof vi.fn>;
    getActiveCount: ReturnType<typeof vi.fn>;
    getCompletedCount: ReturnType<typeof vi.fn>;
    getFailedCount: ReturnType<typeof vi.fn>;
    getDelayedCount: ReturnType<typeof vi.fn>;
    constructor(name: string, opts: Record<string, unknown>) {
      queueCalls.push({ name, opts });
      this.add = mockQueueAdd;
      this.close = mockQueueClose;
      this.getWaitingCount = vi.fn().mockResolvedValue(0);
      this.getActiveCount = vi.fn().mockResolvedValue(0);
      this.getCompletedCount = vi.fn().mockResolvedValue(0);
      this.getFailedCount = vi.fn().mockResolvedValue(0);
      this.getDelayedCount = vi.fn().mockResolvedValue(0);
    }
  }

  return {
    Worker: MockWorker,
    Queue: MockQueue,
    Job: vi.fn(),
  };
});

// ── Mock @ai-cofounder/shared ──

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Mock connection module ──

vi.mock("../connection.js", () => ({
  getRedisConnection: vi.fn().mockReturnValue({ host: "localhost", port: 6379 }),
  resetRedisConnection: vi.fn(),
}));

// ── Import modules under test AFTER mocks ──

import { startWorkers } from "../workers.js";
import { getAgentTaskQueue, closeAllQueues } from "../queues.js";
import { enqueueAgentTask } from "../helpers.js";

beforeEach(async () => {
  // Reset call tracking
  workerCalls.length = 0;
  queueCalls.length = 0;
  mockQueueAdd.mockClear();
  mockWorkerOn.mockClear();

  // Close and clear the queue cache so each test gets fresh Queue constructor calls
  await closeAllQueues();
});

// ── QUEUE-12: Worker configuration for long-running agent tasks ──

describe("QUEUE-12: agent-tasks worker configuration", () => {
  it("creates agent-tasks worker with lockDuration=600000 to prevent false stall detection", () => {
    const processor = vi.fn();
    startWorkers({ agentTask: processor });

    const agentWorkerCall = workerCalls.find((c) => c.queueName === "agent-tasks");
    expect(agentWorkerCall).toBeDefined();
    expect(agentWorkerCall!.opts.lockDuration).toBe(600_000);
  });

  it("creates agent-tasks worker with concurrency=1 for LLM-intensive tasks", () => {
    const processor = vi.fn();
    startWorkers({ agentTask: processor });

    const agentWorkerCall = workerCalls.find((c) => c.queueName === "agent-tasks");
    expect(agentWorkerCall).toBeDefined();
    expect(agentWorkerCall!.opts.concurrency).toBe(1);
  });

  it("creates agent-tasks worker with stalledInterval=30000 to check stalls every 30s", () => {
    const processor = vi.fn();
    startWorkers({ agentTask: processor });

    const agentWorkerCall = workerCalls.find((c) => c.queueName === "agent-tasks");
    expect(agentWorkerCall).toBeDefined();
    expect(agentWorkerCall!.opts.stalledInterval).toBe(30_000);
  });

  it("creates agent-tasks worker with maxStalledCount=1 to re-queue once before failing", () => {
    const processor = vi.fn();
    startWorkers({ agentTask: processor });

    const agentWorkerCall = workerCalls.find((c) => c.queueName === "agent-tasks");
    expect(agentWorkerCall).toBeDefined();
    expect(agentWorkerCall!.opts.maxStalledCount).toBe(1);
  });
});

// ── QUEUE-05: Retry configuration ──

describe("QUEUE-05: job retry configuration", () => {
  it("configures agent-tasks queue with 3 retry attempts", () => {
    getAgentTaskQueue();

    const queueCall = queueCalls.find((c) => c.name === "agent-tasks");
    expect(queueCall).toBeDefined();
    const defaultJobOptions = queueCall!.opts.defaultJobOptions as Record<string, unknown>;
    expect(defaultJobOptions?.attempts).toBe(3);
  });

  it("configures agent-tasks queue with exponential backoff starting at 2000ms", () => {
    getAgentTaskQueue();

    const queueCall = queueCalls.find((c) => c.name === "agent-tasks");
    expect(queueCall).toBeDefined();
    const defaultJobOptions = queueCall!.opts.defaultJobOptions as Record<string, unknown>;
    expect(defaultJobOptions?.backoff).toEqual({
      type: "exponential",
      delay: 2000,
    });
  });
});

// ── QUEUE-13: TTL-based job cleanup ──

describe("QUEUE-13: TTL-based job cleanup", () => {
  it("uses age-based TTL for completed jobs (24h = 86400 seconds)", () => {
    getAgentTaskQueue();

    const queueCall = queueCalls.find((c) => c.name === "agent-tasks");
    expect(queueCall).toBeDefined();
    const defaultJobOptions = queueCall!.opts.defaultJobOptions as Record<string, unknown>;
    expect(defaultJobOptions?.removeOnComplete).toMatchObject({ age: 86400 });
  });

  it("uses age-based TTL for failed jobs (7 days = 604800 seconds)", () => {
    getAgentTaskQueue();

    const queueCall = queueCalls.find((c) => c.name === "agent-tasks");
    expect(queueCall).toBeDefined();
    const defaultJobOptions = queueCall!.opts.defaultJobOptions as Record<string, unknown>;
    expect(defaultJobOptions?.removeOnFail).toMatchObject({ age: 604800 });
  });
});

// ── QUEUE-09: Priority mapping ──

describe("QUEUE-09: job priority mapping", () => {
  it("maps critical priority to BullMQ priority 1 (highest)", async () => {
    await enqueueAgentTask({
      goalId: "goal-1",
      prompt: "test prompt",
      priority: "critical",
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 1 }),
    );
  });

  it("maps low priority to BullMQ priority 4 (lowest)", async () => {
    await enqueueAgentTask({
      goalId: "goal-2",
      prompt: "test prompt",
      priority: "low",
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.any(Object),
      expect.objectContaining({ priority: 4 }),
    );
  });
});
