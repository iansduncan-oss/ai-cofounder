import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockMarkEventProcessed = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  markEventProcessed: (...args: unknown[]) => mockMarkEventProcessed(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn();
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
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
  optionalEnv: vi.fn((_name: string, defaultValue: string) => defaultValue),
  requireEnv: vi.fn().mockReturnValue("test"),
}));

const { processEvent } = await import("../events.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkEventProcessed.mockResolvedValue({});
});

describe("processEvent", () => {
  it("marks event as processed", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    const event = {
      id: "evt-1",
      source: "github",
      type: "push",
      payload: { ref: "refs/heads/main" },
    };

    await processEvent(db, registry, event);

    expect(mockMarkEventProcessed).toHaveBeenCalledWith(
      db,
      "evt-1",
      "Event recorded (autonomous processing removed)",
    );
  });

  it("handles different event sources", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    const event = {
      id: "evt-2",
      source: "monitoring",
      type: "alert",
      payload: { severity: "critical" },
    };

    await processEvent(db, registry, event);

    expect(mockMarkEventProcessed).toHaveBeenCalledWith(
      db,
      "evt-2",
      "Event recorded (autonomous processing removed)",
    );
  });
});
