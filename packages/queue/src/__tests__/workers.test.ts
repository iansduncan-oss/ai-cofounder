import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ──

const workerCalls: Array<{
  queueName: string;
  processor: unknown;
  opts: Record<string, unknown>;
}> = [];

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);

vi.mock("bullmq", () => {
  class MockWorker {
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    constructor(queueName: string, processor: unknown, opts: Record<string, unknown>) {
      workerCalls.push({ queueName, processor, opts });
      this.on = mockWorkerOn;
      this.close = mockWorkerClose;
    }
  }
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: "mock-job-id" });
    close = vi.fn().mockResolvedValue(undefined);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    constructor() {}
  }
  return { Worker: MockWorker, Queue: MockQueue, Job: vi.fn() };
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

import { startWorkers, stopWorkers } from "../workers.js";
import { closeAllQueues } from "../queues.js";

beforeEach(async () => {
  workerCalls.length = 0;
  mockWorkerOn.mockClear();
  mockWorkerClose.mockClear();
  await closeAllQueues();
});

describe("startWorkers", () => {
  it("creates all 11 workers when all processors are provided", () => {
    startWorkers({
      agentTask: vi.fn(),
      monitoring: vi.fn(),
      briefing: vi.fn(),
      notification: vi.fn(),
      pipeline: vi.fn(),
      ragIngestion: vi.fn(),
      reflection: vi.fn(),
      subagentTask: vi.fn(),
      deployVerification: vi.fn(),
      autonomousSession: vi.fn(),
      meetingPrep: vi.fn(),
    });

    expect(workerCalls).toHaveLength(11);
    const queueNames = workerCalls.map((c) => c.queueName);
    expect(queueNames).toContain("agent-tasks");
    expect(queueNames).toContain("monitoring");
    expect(queueNames).toContain("briefings");
    expect(queueNames).toContain("notifications");
    expect(queueNames).toContain("pipelines");
    expect(queueNames).toContain("rag-ingestion");
    expect(queueNames).toContain("reflections");
    expect(queueNames).toContain("subagent-tasks");
    expect(queueNames).toContain("deploy-verification");
    expect(queueNames).toContain("autonomous-sessions");
    expect(queueNames).toContain("meeting-prep");
  });

  it("creates no workers when no processors are provided", () => {
    startWorkers({});
    expect(workerCalls).toHaveLength(0);
  });

  it("creates only workers for provided processors", () => {
    startWorkers({ agentTask: vi.fn(), monitoring: vi.fn() });
    expect(workerCalls).toHaveLength(2);
    expect(workerCalls[0].queueName).toBe("agent-tasks");
    expect(workerCalls[1].queueName).toBe("monitoring");
  });

  describe("worker configurations", () => {
    it("agent-tasks: concurrency=1, lockDuration=600000, stalledInterval=30000, maxStalledCount=1", () => {
      startWorkers({ agentTask: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "agent-tasks")!.opts;
      expect(opts.concurrency).toBe(1);
      expect(opts.lockDuration).toBe(600_000);
      expect(opts.stalledInterval).toBe(30_000);
      expect(opts.maxStalledCount).toBe(1);
    });

    it("monitoring: concurrency=4", () => {
      startWorkers({ monitoring: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "monitoring")!.opts;
      expect(opts.concurrency).toBe(4);
    });

    it("briefing: concurrency=1", () => {
      startWorkers({ briefing: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "briefings")!.opts;
      expect(opts.concurrency).toBe(1);
    });

    it("notification: concurrency=5", () => {
      startWorkers({ notification: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "notifications")!.opts;
      expect(opts.concurrency).toBe(5);
    });

    it("pipeline: concurrency=1", () => {
      startWorkers({ pipeline: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "pipelines")!.opts;
      expect(opts.concurrency).toBe(1);
    });

    it("rag-ingestion: concurrency=2, lockDuration=300000", () => {
      startWorkers({ ragIngestion: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "rag-ingestion")!.opts;
      expect(opts.concurrency).toBe(2);
      expect(opts.lockDuration).toBe(300_000);
    });

    it("reflection: concurrency=1, lockDuration=300000", () => {
      startWorkers({ reflection: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "reflections")!.opts;
      expect(opts.concurrency).toBe(1);
      expect(opts.lockDuration).toBe(300_000);
    });

    it("subagent-tasks: concurrency=3, lockDuration=900000, stalledInterval=60000, maxStalledCount=1", () => {
      startWorkers({ subagentTask: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "subagent-tasks")!.opts;
      expect(opts.concurrency).toBe(3);
      expect(opts.lockDuration).toBe(900_000);
      expect(opts.stalledInterval).toBe(60_000);
      expect(opts.maxStalledCount).toBe(1);
    });

    it("deploy-verification: concurrency=1, lockDuration=300000", () => {
      startWorkers({ deployVerification: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "deploy-verification")!.opts;
      expect(opts.concurrency).toBe(1);
      expect(opts.lockDuration).toBe(300_000);
    });

    it("autonomous-sessions: concurrency=1, lockDuration=1800000, stalledInterval=60000, maxStalledCount=1", () => {
      startWorkers({ autonomousSession: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "autonomous-sessions")!.opts;
      expect(opts.concurrency).toBe(1);
      expect(opts.lockDuration).toBe(1_800_000);
      expect(opts.stalledInterval).toBe(60_000);
      expect(opts.maxStalledCount).toBe(1);
    });

    it("meeting-prep: concurrency=1, lockDuration=300000", () => {
      startWorkers({ meetingPrep: vi.fn() });
      const opts = workerCalls.find((c) => c.queueName === "meeting-prep")!.opts;
      expect(opts.concurrency).toBe(1);
      expect(opts.lockDuration).toBe(300_000);
    });
  });

  describe("event handlers", () => {
    it("registers completed, failed, and stalled event handlers on each worker", () => {
      startWorkers({ agentTask: vi.fn() });

      // Each worker gets 3 event handlers: completed, failed, stalled
      const onCalls = mockWorkerOn.mock.calls;
      const events = onCalls.map((c) => c[0]);
      expect(events).toContain("completed");
      expect(events).toContain("failed");
      expect(events).toContain("stalled");
    });

    it("registers 3 event handlers per worker", () => {
      startWorkers({ agentTask: vi.fn(), monitoring: vi.fn() });
      // 2 workers * 3 events = 6 on() calls
      expect(mockWorkerOn).toHaveBeenCalledTimes(6);
    });
  });
});

describe("stopWorkers", () => {
  it("closes all active workers and clears the array", async () => {
    // First, stop any leftover workers from prior tests
    await stopWorkers();
    mockWorkerClose.mockClear();

    startWorkers({ agentTask: vi.fn(), monitoring: vi.fn() });
    await stopWorkers();

    expect(mockWorkerClose).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no workers are active", async () => {
    // Ensure clean slate
    await stopWorkers();
    mockWorkerClose.mockClear();

    await stopWorkers();
    expect(mockWorkerClose).not.toHaveBeenCalled();
  });
});
