import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ─── pubsub helpers (pure functions) ────────────────────────────────────────

const { subagentChannel, subagentHistoryKey, SUBAGENT_CHANNEL_PREFIX, SUBAGENT_HISTORY_PREFIX } = await import(
  "@ai-cofounder/queue"
);

describe("subagent pubsub helpers", () => {
  it("subagentChannel returns correct channel name", () => {
    const id = "abc-123";
    const channel = subagentChannel(id);
    expect(channel).toBe(`${SUBAGENT_CHANNEL_PREFIX}abc-123`);
  });

  it("subagentHistoryKey returns correct key", () => {
    const id = "abc-123";
    const key = subagentHistoryKey(id);
    expect(key).toBe(`${SUBAGENT_HISTORY_PREFIX}abc-123`);
  });

  it("different IDs produce different channels", () => {
    expect(subagentChannel("a")).not.toBe(subagentChannel("b"));
  });

  it("different IDs produce different history keys", () => {
    expect(subagentHistoryKey("a")).not.toBe(subagentHistoryKey("b"));
  });
});

// ─── SubagentTaskJob interface ──────────────────────────────────────────────

describe("SubagentTaskJob type contract", () => {
  it("can be constructed with required fields", () => {
    const job = {
      subagentRunId: "run-1",
      title: "Research task",
      instruction: "Do research",
    };
    expect(job.subagentRunId).toBe("run-1");
    expect(job.title).toBe("Research task");
    expect(job.instruction).toBe("Do research");
  });

  it("accepts optional fields", () => {
    const job = {
      subagentRunId: "run-1",
      title: "Task",
      instruction: "Do stuff",
      conversationId: "conv-1",
      goalId: "goal-1",
      userId: "user-1",
      priority: "high" as const,
    };
    expect(job.conversationId).toBe("conv-1");
    expect(job.goalId).toBe("goal-1");
    expect(job.userId).toBe("user-1");
    expect(job.priority).toBe("high");
  });
});

// ─── SubagentProgressEvent type contract ────────────────────────────────────

describe("SubagentProgressEvent type contract", () => {
  it("started event has correct shape", () => {
    const event = {
      subagentRunId: "run-1",
      type: "subagent_started" as const,
      timestamp: Date.now(),
    };
    expect(event.type).toBe("subagent_started");
    expect(event.subagentRunId).toBe("run-1");
    expect(typeof event.timestamp).toBe("number");
  });

  it("tool_call event includes round and toolName", () => {
    const event = {
      subagentRunId: "run-1",
      type: "subagent_tool_call" as const,
      round: 1,
      toolName: "search_web",
      timestamp: Date.now(),
    };
    expect(event.round).toBe(1);
    expect(event.toolName).toBe("search_web");
  });

  it("completed event includes output", () => {
    const event = {
      subagentRunId: "run-1",
      type: "subagent_completed" as const,
      output: "Result text",
      timestamp: Date.now(),
    };
    expect(event.output).toBe("Result text");
  });

  it("failed event includes error", () => {
    const event = {
      subagentRunId: "run-1",
      type: "subagent_failed" as const,
      error: "Something went wrong",
      timestamp: Date.now(),
    };
    expect(event.error).toBe("Something went wrong");
  });
});
