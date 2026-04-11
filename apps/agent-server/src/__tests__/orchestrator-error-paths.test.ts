import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockComplete = vi.fn();
const mockCreateGoal = vi.fn().mockResolvedValue({ id: "goal-1", title: "Test Goal" });
const mockCreateTask = vi.fn().mockImplementation(async (_db: any, input: any) => ({
  id: `task-${input.orderIndex}`,
  title: input.title,
  assignedAgent: input.assignedAgent,
  orderIndex: input.orderIndex,
}));
const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});
const mockSaveMemory = vi.fn().mockResolvedValue({ key: "pref", category: "preferences" });
const mockRecallMemories = vi.fn().mockResolvedValue([]);
const mockSearchMemoriesByVector = vi.fn().mockResolvedValue([]);
const mockCreateApproval = vi.fn().mockResolvedValue({ id: "approval-1" });
const mockGetN8nWorkflowByName = vi.fn();
const mockListN8nWorkflows = vi.fn().mockResolvedValue([]);
const mockRetrieve = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  searchMemoriesByVector: (...args: unknown[]) => mockSearchMemoriesByVector(...args),
  createApproval: (...args: unknown[]) => mockCreateApproval(...args),
  getN8nWorkflowByName: (...args: unknown[]) => mockGetN8nWorkflowByName(...args),
  listN8nWorkflows: (...args: unknown[]) => mockListN8nWorkflows(...args),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
  touchMemory: vi.fn().mockResolvedValue(undefined),
  recordToolExecution: vi.fn().mockResolvedValue({ id: "te-1" }),
}));

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
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: (...args: unknown[]) => mockRetrieve(...args),
  formatContext: vi.fn().mockReturnValue("formatted RAG context"),
}));

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: {
    name: "search_web",
    description: "Search",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  SAVE_MEMORY_TOOL: {
    name: "save_memory",
    description: "Save",
    input_schema: { type: "object", properties: {} },
  },
  RECALL_MEMORIES_TOOL: {
    name: "recall_memories",
    description: "Recall",
    input_schema: { type: "object", properties: {} },
  },
}));

vi.mock("../agents/tools/n8n-tools.js", () => ({
  TRIGGER_N8N_WORKFLOW_TOOL: {
    name: "trigger_workflow",
    description: "Trigger",
    input_schema: { type: "object", properties: {} },
  },
  LIST_N8N_WORKFLOWS_TOOL: {
    name: "list_workflows",
    description: "List",
    input_schema: { type: "object", properties: {} },
  },
}));

const { validateDependencyGraph, Orchestrator } = await import("../agents/orchestrator.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete.mockReset();
  mockRetrieve.mockReset();
});

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

/* ── validateDependencyGraph ── */

describe("validateDependencyGraph", () => {
  function task(overrides: { depends_on?: number[] } = {}) {
    return {
      title: "Task",
      description: "A task",
      assigned_agent: "researcher" as const,
      ...overrides,
    };
  }

  it("accepts a valid DAG with no dependencies", () => {
    expect(() => validateDependencyGraph([task(), task(), task()])).not.toThrow();
  });

  it("accepts a valid chain: task 1 → 0, task 2 → 1", () => {
    expect(() =>
      validateDependencyGraph([task(), task({ depends_on: [0] }), task({ depends_on: [1] })]),
    ).not.toThrow();
  });

  it("accepts a valid diamond: task 2 → [0,1], task 3 → [2]", () => {
    expect(() =>
      validateDependencyGraph([
        task(),
        task(),
        task({ depends_on: [0, 1] }),
        task({ depends_on: [2] }),
      ]),
    ).not.toThrow();
  });

  it("rejects self-dependency", () => {
    expect(() =>
      validateDependencyGraph([
        task(),
        task({ depends_on: [1] }), // depends on itself
      ]),
    ).toThrow("invalid dependency index");
  });

  it("rejects negative dependency index", () => {
    expect(() => validateDependencyGraph([task(), task({ depends_on: [-1] })])).toThrow(
      "invalid dependency index",
    );
  });

  it("rejects dependency index >= task count (out of bounds)", () => {
    expect(() => validateDependencyGraph([task(), task({ depends_on: [5] })])).toThrow(
      "invalid dependency index",
    );
  });

  it("detects simple cycle: A→B→A", () => {
    expect(() =>
      validateDependencyGraph([task({ depends_on: [1] }), task({ depends_on: [0] })]),
    ).toThrow("Dependency cycle detected");
  });

  it("detects complex cycle: A→B→C→A", () => {
    expect(() =>
      validateDependencyGraph([
        task({ depends_on: [2] }),
        task({ depends_on: [0] }),
        task({ depends_on: [1] }),
      ]),
    ).toThrow("Dependency cycle detected");
  });

  it("accepts empty task list", () => {
    expect(() => validateDependencyGraph([])).not.toThrow();
  });

  it("accepts single task with no deps", () => {
    expect(() => validateDependencyGraph([task()])).not.toThrow();
  });
});

/* ── Orchestrator.trimHistory (tested indirectly via run) ── */

describe("Orchestrator — trimHistory (indirect)", () => {
  it("keeps all history messages when within token budget", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("I remember everything"));

    const registry = new LlmRegistry();
    const orchestrator = new Orchestrator({ registry });

    // Each message ~10 chars → ~3 tokens. 3 messages = ~9 tokens (well within 8000).
    const history = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
      { role: "user" as const, content: "How are you?" },
    ];
    await orchestrator.run("What was my first message?", "conv-trim-1", history as any);

    const callArgs = mockComplete.mock.calls[0][1];
    // history (3) + current message = 4 minimum
    expect(callArgs.messages.length).toBeGreaterThanOrEqual(4);
    // First history message should still be present (not trimmed)
    expect(callArgs.messages[0].content).toBe("Hello");
  });

  it("trims oldest messages when history exceeds token budget", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("ok"));

    const registry = new LlmRegistry();
    const orchestrator = new Orchestrator({ registry });

    // Default maxTokenEstimate = 8000. Each char ≈ 0.25 tokens.
    // A message of 32,000 chars ≈ 8,000 tokens (fills the entire budget).
    // So the first (old) message should be trimmed, and only the recent short one kept.
    const hugeOldMessage = "x".repeat(32_000);
    const history = [
      { role: "user" as const, content: hugeOldMessage },
      { role: "assistant" as const, content: "Short reply" },
    ];
    await orchestrator.run("current question", "conv-trim-2", history as any);

    const callArgs = mockComplete.mock.calls[0][1];
    // The huge old message should have been trimmed.
    // Only the short reply (11 chars ≈ 3 tokens) fits.
    const historyContents = callArgs.messages.map((m: any) => m.content);
    expect(historyContents).not.toContain(hugeOldMessage);
    expect(historyContents).toContain("Short reply");
    // Current message should always be present
    expect(historyContents).toContain("current question");
  });

  it("handles empty history gracefully", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("ok"));

    const registry = new LlmRegistry();
    const orchestrator = new Orchestrator({ registry });
    await orchestrator.run("just me", "conv-trim-3", []);

    const callArgs = mockComplete.mock.calls[0][1];
    // Only the current user message (+ possible context injections)
    expect(callArgs.messages.length).toBeGreaterThanOrEqual(1);
    const lastUserMsg = callArgs.messages.filter((m: any) => m.role === "user").pop();
    expect(lastUserMsg.content).toBe("just me");
  });

  it("drops all history when a single message exceeds the budget", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("ok"));

    const registry = new LlmRegistry();
    const orchestrator = new Orchestrator({ registry });

    // One message of 40,000 chars ≈ 10,000 tokens — exceeds the 8,000 budget.
    const oversizedMessage = "a".repeat(40_000);
    const history = [{ role: "user" as const, content: oversizedMessage }];
    await orchestrator.run("new question", "conv-trim-4", history as any);

    const callArgs = mockComplete.mock.calls[0][1];
    const historyContents = callArgs.messages.map((m: any) => m.content);
    // The oversized message should not appear in the messages
    expect(historyContents).not.toContain(oversizedMessage);
    // Current message is still there
    expect(historyContents).toContain("new question");
  });
});

/* ── RAG retrieval failure (graceful degradation) ── */

describe("Orchestrator — RAG retrieval failure", () => {
  it("still returns a response when RAG retrieval throws", async () => {
    mockRetrieve.mockRejectedValueOnce(new Error("RAG connection failed"));
    mockComplete.mockResolvedValueOnce(textResponse("I can still help!"));

    const registry = new LlmRegistry();
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embeddingService = { embed: mockEmbed };
    const mockDb = { execute: vi.fn().mockResolvedValue([]) } as any;

    const orchestrator = new Orchestrator({ registry, db: mockDb, embeddingService });
    const result = await orchestrator.run("tell me something");

    // Orchestrator should still produce a response despite RAG failure
    expect(result.response).toBe("I can still help!");
    expect(result.agentRole).toBe("orchestrator");
    // RAG retrieve was called and threw
    expect(mockRetrieve).toHaveBeenCalled();
  });
});
