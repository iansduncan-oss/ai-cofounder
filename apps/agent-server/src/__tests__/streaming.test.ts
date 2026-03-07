import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  getConversationMessageCount: vi.fn().mockResolvedValue(0),
  getLatestConversationSummary: vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn().mockResolvedValue({}),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  recordLlmUsage: vi.fn().mockResolvedValue({}),
  getTodayTokenTotal: vi.fn().mockResolvedValue(0),
  saveMemory: vi.fn().mockResolvedValue({}),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getActivePrompt: vi.fn(),
  goals: {},
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Streamed response" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "anthropic",
  });

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
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/agents/run/stream", { timeout: 15_000 }, () => {
  it("returns SSE headers", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("emits SSE events in order", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    const body = res.body;
    const events = body
      .split("\n\n")
      .filter(Boolean)
      .map((block: string) => {
        const eventLine = block.split("\n").find((l: string) => l.startsWith("event: "));
        return eventLine ? eventLine.slice(7) : null;
      })
      .filter(Boolean);

    // Should contain at least thinking and done events
    expect(events).toContain("thinking");
    expect(events).toContain("done");

    // done should come last
    expect(events[events.length - 1]).toBe("done");
  });

  it("done event contains response data", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello", userId: "user-1" },
    });
    await app.close();

    const blocks = res.body.split("\n\n").filter(Boolean);
    const doneBlock = blocks.find((b: string) => b.includes("event: done"));
    expect(doneBlock).toBeDefined();

    const dataLine = doneBlock!.split("\n").find((l: string) => l.startsWith("data: "));
    const doneData = JSON.parse(dataLine!.slice(6));
    expect(doneData).toHaveProperty("response");
    expect(doneData).toHaveProperty("model");
  });

  it("enforces daily token limit", async () => {
    process.env.DAILY_TOKEN_LIMIT = "100";
    const { getTodayTokenTotal } = await import("@ai-cofounder/db");
    (getTodayTokenTotal as ReturnType<typeof vi.fn>).mockResolvedValueOnce(200);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/run/stream",
      payload: { message: "Hello" },
    });
    await app.close();

    expect(res.statusCode).toBe(429);
    delete process.env.DAILY_TOKEN_LIMIT;
  });
});
