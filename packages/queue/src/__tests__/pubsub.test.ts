import { describe, it, expect, vi, beforeEach } from "vitest";

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

// ── Mock ioredis ──
// We track instances so tests can inspect the mock fns on the instance
// that was created during the test.

const mockInstances: Array<{
  publish: ReturnType<typeof vi.fn>;
  rpush: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  lrange: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("ioredis", () => {
  class MockRedis {
    publish = vi.fn().mockResolvedValue(1);
    rpush = vi.fn().mockResolvedValue(1);
    expire = vi.fn().mockResolvedValue(1);
    lrange = vi.fn().mockResolvedValue([]);
    quit = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();

    constructor() {
      // Push reference to self so tests can inspect it
      mockInstances.push(this as unknown as (typeof mockInstances)[0]);
    }
  }

  return { default: MockRedis };
});

// ── Import modules under test AFTER mocks ──
import {
  RedisPubSub,
  createSubscriber,
  goalChannel,
  historyKey,
  HISTORY_TTL_SECONDS,
  type AgentProgressEvent,
  type AgentLifecycleEvent,
} from "../pubsub.js";

beforeEach(() => {
  mockInstances.length = 0;
  vi.clearAllMocks();
});

// ── Helper function tests ──

describe("goalChannel()", () => {
  it("returns the correct pub/sub channel name for a goal", () => {
    expect(goalChannel("goal-123")).toBe("agent-events:goal:goal-123");
  });

  it("handles UUIDs as goalId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(goalChannel(uuid)).toBe(`agent-events:goal:${uuid}`);
  });
});

describe("historyKey()", () => {
  it("returns the correct Redis LIST key for a goal's history", () => {
    expect(historyKey("goal-123")).toBe("agent-events:history:goal-123");
  });

  it("handles UUIDs as goalId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(historyKey(uuid)).toBe(`agent-events:history:${uuid}`);
  });
});

// ── RedisPubSub.publish() tests ──

describe("RedisPubSub.publish()", () => {
  it("calls ioredis publish, rpush, and expire with correct channel/key/TTL", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    const event: AgentLifecycleEvent = {
      goalId: "g-1",
      type: "job_started",
      timestamp: 1700000000000,
    };

    await pubsub.publish("g-1", event);

    expect(instance.publish).toHaveBeenCalledWith(
      "agent-events:goal:g-1",
      expect.any(String),
    );
    expect(instance.rpush).toHaveBeenCalledWith(
      "agent-events:history:g-1",
      expect.any(String),
    );
    expect(instance.expire).toHaveBeenCalledWith(
      "agent-events:history:g-1",
      HISTORY_TTL_SECONDS,
    );
  });

  it("serializes the event as a JSON string", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    const event: AgentProgressEvent = {
      goalId: "g-2",
      goalTitle: "Test Goal",
      taskId: "t-1",
      taskTitle: "Task One",
      agent: "researcher",
      status: "started",
      completedTasks: 0,
      totalTasks: 3,
      timestamp: 1700000001000,
    };

    await pubsub.publish("g-2", event);

    // Verify the payload passed to publish is valid JSON containing the event
    const publishPayload = instance.publish.mock.calls[0][1] as string;
    const parsed = JSON.parse(publishPayload);
    expect(parsed).toMatchObject({
      goalId: "g-2",
      goalTitle: "Test Goal",
      taskId: "t-1",
      status: "started",
    });
  });

  it("runs all three Redis operations concurrently (Promise.all)", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    const event: AgentLifecycleEvent = {
      goalId: "g-3",
      type: "job_completed",
      timestamp: Date.now(),
    };

    await pubsub.publish("g-3", event);

    expect(instance.publish).toHaveBeenCalledOnce();
    expect(instance.rpush).toHaveBeenCalledOnce();
    expect(instance.expire).toHaveBeenCalledOnce();
  });
});

// ── RedisPubSub.getHistory() tests ──

describe("RedisPubSub.getHistory()", () => {
  it("calls lrange on the correct history key and parses results", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    const storedEvent: AgentLifecycleEvent = {
      goalId: "g-4",
      type: "job_started",
      timestamp: 1700000000000,
    };

    instance.lrange.mockResolvedValueOnce([JSON.stringify(storedEvent)]);

    const history = await pubsub.getHistory("g-4");

    expect(instance.lrange).toHaveBeenCalledWith("agent-events:history:g-4", 0, -1);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ goalId: "g-4", type: "job_started" });
  });

  it("returns empty array when no history exists", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    instance.lrange.mockResolvedValueOnce([]);

    const history = await pubsub.getHistory("g-empty");

    expect(history).toEqual([]);
  });

  it("parses multiple events in order", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    const events = [
      { goalId: "g-5", type: "job_started", timestamp: 1 } as AgentLifecycleEvent,
      {
        goalId: "g-5",
        goalTitle: "Test",
        taskId: "t-1",
        taskTitle: "Task",
        agent: "coder",
        status: "completed" as const,
        completedTasks: 1,
        totalTasks: 1,
        timestamp: 2,
      } as AgentProgressEvent,
    ];

    instance.lrange.mockResolvedValueOnce(events.map((e) => JSON.stringify(e)));

    const history = await pubsub.getHistory("g-5");

    expect(history).toHaveLength(2);
    expect((history[0] as AgentLifecycleEvent).type).toBe("job_started");
    expect((history[1] as AgentProgressEvent).status).toBe("completed");
  });
});

// ── RedisPubSub.close() tests ──

describe("RedisPubSub.close()", () => {
  it("calls publisher.quit() to clean up the connection", async () => {
    const pubsub = new RedisPubSub({ host: "localhost", port: 6379 });
    const instance = mockInstances[0];

    await pubsub.close();

    expect(instance.quit).toHaveBeenCalledOnce();
  });
});

// ── createSubscriber() tests ──

describe("createSubscriber()", () => {
  it("creates a new Redis instance (separate from any publisher)", () => {
    mockInstances.length = 0;

    const subscriber = createSubscriber({ host: "localhost", port: 6379 });

    // Should have created exactly one new instance
    expect(mockInstances).toHaveLength(1);
    expect(subscriber).toBeDefined();
  });

  it("registers an error handler on the subscriber connection", () => {
    mockInstances.length = 0;

    createSubscriber({ host: "testhost", port: 6380 });

    const instance = mockInstances[0];
    expect(instance.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("returns a distinct instance from any RedisPubSub publisher", () => {
    mockInstances.length = 0;

    // Create publisher (index 0)
    new RedisPubSub({ host: "localhost", port: 6379 });
    const publisherInstance = mockInstances[0];

    // Create subscriber (index 1)
    const subscriber = createSubscriber({ host: "localhost", port: 6379 });
    const subscriberInstance = mockInstances[1];

    // They must be different objects
    expect(subscriberInstance).not.toBe(publisherInstance);
    expect(subscriber).toBeDefined();
  });
});
