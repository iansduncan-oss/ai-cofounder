import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock @ai-cofounder/shared ──────────────────────────────────────────────────

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

// ── Mock @ai-cofounder/db ──────────────────────────────────────────────────────

const mockSaveMemory = vi.fn().mockResolvedValue({ id: "mem-1" });
const mockSearchMemoriesByVector = vi.fn().mockResolvedValue([]);
const mockRecallMemories = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
  searchMemoriesByVector: (...args: unknown[]) => mockSearchMemoriesByVector(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  getActivePrompt: vi.fn().mockResolvedValue(null),
  getActivePersona: vi.fn().mockResolvedValue(null),
}));

// ── Mock @ai-cofounder/llm ─────────────────────────────────────────────────────

const mockComplete = vi.fn();

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
    GeminiProvider: class {},
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

// ── Mock @ai-cofounder/rag ─────────────────────────────────────────────────────

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

// ── Mock agent tools that orchestrator imports ─────────────────────────────────

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: { name: "search_web", description: "Search", input_schema: { type: "object", properties: {}, required: [] } },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  SAVE_MEMORY_TOOL: { name: "save_memory", description: "Save", input_schema: { type: "object", properties: {} } },
  RECALL_MEMORIES_TOOL: { name: "recall_memories", description: "Recall", input_schema: { type: "object", properties: {} } },
}));

vi.mock("../agents/tools/n8n-tools.js", () => ({
  TRIGGER_N8N_WORKFLOW_TOOL: { name: "trigger_workflow", description: "Trigger", input_schema: { type: "object", properties: {} } },
  LIST_N8N_WORKFLOWS_TOOL: { name: "list_workflows", description: "List", input_schema: { type: "object", properties: {} } },
}));

// ── Import modules under test ──────────────────────────────────────────────────

const { DecisionExtractorService } = await import("../services/decision-extractor.js");
const { Orchestrator } = await import("../agents/orchestrator.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonResponse(obj: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 50 },
    provider: "test",
  };
}

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

const LONG_RESPONSE = "A".repeat(200);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("decision extraction", () => {
  it("extracts and stores decision from response with decision language", async () => {
    mockComplete.mockResolvedValue(jsonResponse({
      hasDecision: true,
      title: "Use Postgres",
      decision: "Going with Postgres for persistence",
      rationale: "Better JSON support",
      alternatives: ["MongoDB", "SQLite"],
    }));

    const registry = new LlmRegistry();
    const db = {} as any;
    const service = new DecisionExtractorService(db, registry);

    await service.extractAndStore(LONG_RESPONSE, "user-1", "conv-1");

    expect(mockSaveMemory).toHaveBeenCalledOnce();
    const [, saveData] = mockSaveMemory.mock.calls[0];
    expect(saveData.category).toBe("decisions");
    expect(saveData.key).toBe("Use Postgres");
    expect(saveData.content).toBe("Going with Postgres for persistence");
    expect(saveData.metadata).toMatchObject({
      rationale: "Better JSON support",
      alternatives: ["MongoDB", "SQLite"],
      conversationId: "conv-1",
    });
    expect(saveData.metadata.extractedAt).toBeDefined();
  });

  it("skips extraction for short responses (< 100 chars)", async () => {
    const registry = new LlmRegistry();
    const service = new DecisionExtractorService({} as any, registry);

    await service.extractAndStore("Short response", "user-1");

    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("handles no-decision response gracefully", async () => {
    mockComplete.mockResolvedValue(jsonResponse({ hasDecision: false }));

    const registry = new LlmRegistry();
    const service = new DecisionExtractorService({} as any, registry);

    await service.extractAndStore(LONG_RESPONSE, "user-1");

    expect(mockComplete).toHaveBeenCalledOnce();
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("handles LLM parse failure gracefully", async () => {
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "not valid json {{{{" }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      provider: "test",
    });

    const registry = new LlmRegistry();
    const service = new DecisionExtractorService({} as any, registry);

    // Should not throw
    await expect(service.extractAndStore(LONG_RESPONSE, "user-1")).resolves.toBeUndefined();
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it("truncates long responses to 2000 chars before sending to LLM", async () => {
    mockComplete.mockResolvedValue(jsonResponse({ hasDecision: false }));

    const registry = new LlmRegistry();
    const service = new DecisionExtractorService({} as any, registry);

    const longResponse = "X".repeat(5000);
    await service.extractAndStore(longResponse, "user-1");

    expect(mockComplete).toHaveBeenCalledOnce();
    const callArgs = mockComplete.mock.calls[0][1];
    const promptContent = callArgs.messages[0].content as string;
    // The prompt includes the truncated response (2000 chars max from response)
    // The full 5000-char response should NOT appear in full
    expect(promptContent).not.toContain("X".repeat(2001));
    // But should contain some X's (the truncated portion)
    expect(promptContent).toContain("X".repeat(100));
  });
});

describe("proactive reference", () => {
  it("orchestrator includes decision memories in a separate section", async () => {
    // Mock searchMemoriesByVector to return a decision memory
    mockSearchMemoriesByVector.mockResolvedValue([
      {
        id: "mem-decision-1",
        category: "decisions",
        key: "Use Postgres",
        content: "Going with Postgres for the main database",
        importance: 8,
        userId: "user-1",
        source: null,
        metadata: { rationale: "Better JSON support" },
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // LLM returns a text response
    mockComplete.mockResolvedValue(textResponse("Sure, here is how we set up Postgres..."));

    const registry = new LlmRegistry();
    const orchestrator = new Orchestrator({
      registry,
      db: {} as any,
      embeddingService: { embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)) } as any,
    });

    const result = await orchestrator.run("How do we set up the database?", "conv-1", undefined, "user-1");

    // Verify LLM was called and the system prompt includes the past decisions block
    expect(mockComplete).toHaveBeenCalled();
    const callArgs = mockComplete.mock.calls[0][1];
    const systemPrompt = callArgs.system as string;

    expect(systemPrompt).toContain("Past decisions relevant to this topic");
    expect(systemPrompt).toContain("Use Postgres");
    expect(systemPrompt).toContain("Going with Postgres for the main database");

    // Verify the result is returned correctly
    expect(result.response).toBe("Sure, here is how we set up Postgres...");
  });
});
