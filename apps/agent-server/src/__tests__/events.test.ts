import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockMarkEventProcessed = vi.fn().mockResolvedValue({});
const mockCreateWorkSession = vi.fn().mockResolvedValue({ id: "ws-1" });
const mockCompleteWorkSession = vi.fn().mockResolvedValue({});
const mockListActiveGoals = vi.fn().mockResolvedValue([]);
const mockListRecentWorkSessions = vi.fn().mockResolvedValue([]);
const mockCountTasksByStatus = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  markEventProcessed: (...args: unknown[]) => mockMarkEventProcessed(...args),
  createWorkSession: (...args: unknown[]) => mockCreateWorkSession(...args),
  completeWorkSession: (...args: unknown[]) => mockCompleteWorkSession(...args),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listRecentWorkSessions: (...args: unknown[]) => mockListRecentWorkSessions(...args),
  countTasksByStatus: (...args: unknown[]) => mockCountTasksByStatus(...args),
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  createGoal: vi.fn().mockResolvedValue({ id: "g-1", title: "Test" }),
  createTask: vi.fn().mockResolvedValue({ id: "t-1", title: "Task", orderIndex: 0, assignedAgent: "researcher" }),
  updateGoalStatus: vi.fn(),
  createApproval: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  deleteSchedule: vi.fn(),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Processed the event and took action" }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 100 },
    provider: "test",
  });
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
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
  mockCreateWorkSession.mockResolvedValue({ id: "ws-1" });
  mockCompleteWorkSession.mockResolvedValue({});
  mockListActiveGoals.mockResolvedValue([]);
  mockListRecentWorkSessions.mockResolvedValue([]);
  mockCountTasksByStatus.mockResolvedValue({});
});

describe("processEvent", () => {
  it("processes an event and marks it as processed", async () => {
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
      expect.any(String),
    );
  });

  it("creates a work session with event trigger", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    const event = {
      id: "evt-2",
      source: "n8n",
      type: "workflow_complete",
      payload: { workflowId: "wf-1" },
    };

    await processEvent(db, registry, event);

    expect(mockCreateWorkSession).toHaveBeenCalledWith(db, expect.objectContaining({
      trigger: "event",
      eventId: "evt-2",
    }));
  });

  it("marks event as processed even when orchestrator fails", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    // Make orchestrator fail
    (registry.complete as any).mockRejectedValueOnce(new Error("LLM error"));

    const event = {
      id: "evt-3",
      source: "webhook",
      type: "alert",
      payload: {},
    };

    await processEvent(db, registry, event);

    expect(mockMarkEventProcessed).toHaveBeenCalledWith(
      db,
      "evt-3",
      expect.stringContaining("LLM error"),
    );
  });

  it("includes event details in the prompt context", async () => {
    const db = {} as any;
    const registry = new LlmRegistry();
    const event = {
      id: "evt-4",
      source: "monitoring",
      type: "alert",
      payload: { severity: "critical", message: "High CPU" },
    };

    await processEvent(db, registry, event);

    // The work session should be created with event context
    expect(mockCreateWorkSession).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        context: expect.objectContaining({
          prompt: expect.stringContaining("monitoring"),
        }),
      }),
    );
  });
});
