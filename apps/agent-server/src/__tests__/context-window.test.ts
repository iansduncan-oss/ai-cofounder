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
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Mock @ai-cofounder/db ──────────────────────────────────────────────────────

const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockGetConversationMessageCount = vi.fn().mockResolvedValue(0);
const mockGetLatestConversationSummary = vi.fn().mockResolvedValue(null);
const mockSaveConversationSummary = vi.fn().mockResolvedValue({ id: "summary-1" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  getConversationMessageCount: (...args: unknown[]) => mockGetConversationMessageCount(...args),
  getLatestConversationSummary: (...args: unknown[]) => mockGetLatestConversationSummary(...args),
  saveConversationSummary: (...args: unknown[]) => mockSaveConversationSummary(...args),
}));

// ── Mock @ai-cofounder/llm ─────────────────────────────────────────────────────

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Summary of older messages" }],
  model: "test-model",
  stop_reason: "end_turn",
  usage: { inputTokens: 100, outputTokens: 50 },
  provider: "test",
});

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
  return { LlmRegistry: MockLlmRegistry };
});

// ── Mock @ai-cofounder/rag ─────────────────────────────────────────────────────

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

// ── Import module under test ────────────────────────────────────────────────────

const { ContextWindowManager } = await import("../services/context-window.js");

// ── Helpers ─────────────────────────────────────────────────────────────────────

const db = {} as any;
const registry = { complete: mockComplete } as any;

function makeHistory(count: number, contentLength = 100) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    conversationId: "conv-1",
    role: i % 2 === 0 ? ("user" as const) : ("agent" as const),
    content: `Message ${i}: ${"x".repeat(contentLength)}`,
    createdAt: new Date(Date.now() - (count - i) * 60_000),
  }));
}

function makeDbMessages(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `db-msg-${offset + i}`,
    conversationId: "conv-1",
    role: i % 2 === 0 ? "user" : "agent",
    agentRole: i % 2 === 1 ? "orchestrator" : null,
    content: `DB message ${offset + i}: ${"x".repeat(100)}`,
    metadata: null,
    createdAt: new Date(Date.now() - (count - i) * 60_000),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConversationMessages.mockResolvedValue([]);
  mockGetConversationMessageCount.mockResolvedValue(0);
  mockGetLatestConversationSummary.mockResolvedValue(null);
  mockSaveConversationSummary.mockResolvedValue({ id: "summary-1" });
  mockComplete.mockResolvedValue({
    content: [{ type: "text", text: "Summary of older messages" }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 50 },
    provider: "test",
  });
});

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("ContextWindowManager", () => {
  describe("prepareHistory — short conversations", () => {
    it("returns client history unchanged when under threshold", async () => {
      mockGetConversationMessageCount.mockResolvedValue(10);
      const history = makeHistory(10);

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toEqual(history);
      expect(result.totalDbMessages).toBe(10);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("loads from DB when no client history provided", async () => {
      const dbMsgs = makeDbMessages(5);
      mockGetConversationMessages.mockResolvedValue([...dbMsgs].reverse()); // DB returns DESC
      mockGetConversationMessageCount.mockResolvedValue(5);

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1");

      expect(mockGetConversationMessages).toHaveBeenCalledWith(db, "conv-1", 50);
      expect(result.wasSummarized).toBe(false);
      expect(result.messages).toHaveLength(5);
    });
  });

  describe("prepareHistory — long conversations (stale summary)", () => {
    it("creates a new summary when no existing summary", async () => {
      const history = makeHistory(20);
      const olderMessages = makeDbMessages(10, 50);
      mockGetConversationMessageCount.mockResolvedValue(50);
      mockGetLatestConversationSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([...olderMessages].reverse());

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      expect(result.wasSummarized).toBe(true);
      // Summary prepended as first message
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toContain("[Previous conversation summary]");
      expect(result.messages[0].content).toContain("Summary of older messages");
      // Original history follows
      expect(result.messages.slice(1)).toEqual(history);
      // Summary was saved
      expect(mockSaveConversationSummary).toHaveBeenCalledOnce();
      expect(mockSaveConversationSummary.mock.calls[0][1]).toMatchObject({
        conversationId: "conv-1",
        summary: "Summary of older messages",
        messageCount: 50,
      });
    });

    it("creates a new summary when existing summary is stale", async () => {
      const history = makeHistory(20);
      const olderMessages = makeDbMessages(10, 50);
      mockGetConversationMessageCount.mockResolvedValue(50);
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "old-summary",
        summary: "Old summary",
        messageCount: 35, // 50 - 35 = 15 > staleSummaryDelta(10)
      });
      mockGetConversationMessages.mockResolvedValue([...olderMessages].reverse());

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      expect(result.wasSummarized).toBe(true);
      expect(mockComplete).toHaveBeenCalledOnce(); // New summary generated
      expect(mockSaveConversationSummary).toHaveBeenCalledOnce();
    });
  });

  describe("prepareHistory — long conversations (cached summary)", () => {
    it("uses existing summary when not stale", async () => {
      const history = makeHistory(20);
      mockGetConversationMessageCount.mockResolvedValue(35);
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "cached-summary",
        summary: "Cached summary text",
        messageCount: 30, // 35 - 30 = 5 < staleSummaryDelta(10)
      });

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      expect(result.wasSummarized).toBe(true);
      expect(result.messages[0].content).toContain("Cached summary text");
      // No new summary created
      expect(mockComplete).not.toHaveBeenCalled();
      expect(mockSaveConversationSummary).not.toHaveBeenCalled();
    });
  });

  describe("prepareHistory — edge cases", () => {
    it("returns history as-is when stale but no older messages exist", async () => {
      const history = makeHistory(20);
      mockGetConversationMessageCount.mockResolvedValue(35);
      mockGetLatestConversationSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([]); // No older messages

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      // applySummarization was entered (wasSummarized=true) but no summary was prepended
      expect(result.wasSummarized).toBe(true);
      expect(result.messages).toEqual(history); // No summary prepended (no older msgs, no cached summary)
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("falls back to existing summary when stale + no older messages", async () => {
      const history = makeHistory(20);
      mockGetConversationMessageCount.mockResolvedValue(45);
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "old-summary",
        summary: "Fallback summary",
        messageCount: 30,
      });
      mockGetConversationMessages.mockResolvedValue([]); // No older messages to resummarize

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      // Should use the existing summary as fallback
      expect(result.messages[0].content).toContain("Fallback summary");
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });

  describe("prepareHistory — offset and staleness fixes", () => {
    it("uses recentMessageCount offset when clientHistory is provided", async () => {
      const history = makeHistory(10); // Client sent 10 messages (not 50)
      const olderMessages = makeDbMessages(10, 50);
      mockGetConversationMessageCount.mockResolvedValue(60);
      mockGetLatestConversationSummary.mockResolvedValue(null);
      mockGetConversationMessages.mockResolvedValue([...olderMessages].reverse());

      const cwm = new ContextWindowManager(db, registry);
      await cwm.prepareHistory("conv-1", history);

      // Implementation uses dbFetchLimit as offset for older message fetch
      expect(mockGetConversationMessages).toHaveBeenCalledWith(db, "conv-1", 50, 50);
    });

    it("uses dbFetchLimit offset when loading from DB (no clientHistory)", async () => {
      const dbMsgs = makeDbMessages(50);
      const olderMessages = makeDbMessages(10, 50);
      mockGetConversationMessageCount.mockResolvedValue(60);
      mockGetLatestConversationSummary.mockResolvedValue(null);
      // First call: load recent messages; Second call: fetch older for summarization
      mockGetConversationMessages
        .mockResolvedValueOnce([...dbMsgs].reverse())
        .mockResolvedValueOnce([...olderMessages].reverse());

      const cwm = new ContextWindowManager(db, registry);
      await cwm.prepareHistory("conv-1");

      // First call loads recent (offset 0), second uses dbFetchLimit (50) as offset
      expect(mockGetConversationMessages).toHaveBeenCalledWith(db, "conv-1", 50);
      expect(mockGetConversationMessages).toHaveBeenCalledWith(db, "conv-1", 50, 50);
    });

    it("treats summary as stale at exactly staleSummaryDelta boundary", async () => {
      const history = makeHistory(20);
      const olderMessages = makeDbMessages(10, 50);
      mockGetConversationMessageCount.mockResolvedValue(40);
      // messageCount=29, delta=10: 29 < 40-10=30 → stale (just past boundary)
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "boundary-summary",
        summary: "Boundary summary",
        messageCount: 29,
      });
      mockGetConversationMessages.mockResolvedValue([...olderMessages].reverse());

      const cwm = new ContextWindowManager(db, registry);
      const result = await cwm.prepareHistory("conv-1", history);

      // Just past staleSummaryDelta boundary: new summary generated
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockSaveConversationSummary).toHaveBeenCalledOnce();
    });
  });

  describe("estimateTokens", () => {
    it("estimates tokens using chars/4 heuristic", () => {
      const cwm = new ContextWindowManager(db, registry);
      const messages = [
        { role: "user" as const, content: "Hello world" }, // 11 chars → 3 tokens
        { role: "agent" as const, content: "Hi there, nice to meet you!" }, // 27 chars → 7 tokens
      ];

      const tokens = cwm.estimateTokens(messages as any);
      expect(tokens).toBe(Math.ceil(11 / 4) + Math.ceil(27 / 4)); // 3 + 7 = 10
    });

    it("returns 0 for empty array", () => {
      const cwm = new ContextWindowManager(db, registry);
      expect(cwm.estimateTokens([])).toBe(0);
    });
  });

  describe("trimToFit", () => {
    it("trims older messages to fit within token budget", () => {
      const cwm = new ContextWindowManager(db, registry, {
        maxHistoryTokens: 100,
        recentMessageCount: 2, // Low so trim actually kicks in
      });
      // Each message: "Message N: " + 120 x's ≈ 131 chars ≈ 33 tokens
      const messages = makeHistory(10, 120);

      const trimmed = cwm.trimToFit(messages as any);
      // Should fit ~3 messages in 100 tokens
      expect(trimmed.length).toBeLessThanOrEqual(4);
      expect(trimmed.length).toBeGreaterThan(0);
      // Should keep the most recent messages
      expect(trimmed[trimmed.length - 1]).toEqual(messages[messages.length - 1]);
    });

    it("preserves at least recentMessageCount messages", () => {
      const cwm = new ContextWindowManager(db, registry, {
        maxHistoryTokens: 10, // Very small budget
        recentMessageCount: 5,
      });
      const messages = makeHistory(10, 100);

      const trimmed = cwm.trimToFit(messages as any);
      expect(trimmed.length).toBe(5);
      // Should be the last 5 messages
      expect(trimmed).toEqual(messages.slice(-5));
    });

    it("returns all messages when they fit within budget", () => {
      const cwm = new ContextWindowManager(db, registry, { maxHistoryTokens: 100_000 });
      const messages = makeHistory(5, 50);

      const trimmed = cwm.trimToFit(messages as any);
      expect(trimmed).toEqual(messages);
    });
  });

  describe("custom config", () => {
    it("respects custom summarizationThreshold", async () => {
      mockGetConversationMessageCount.mockResolvedValue(15);
      const history = makeHistory(10);

      // With threshold of 10, 15 messages should trigger summarization
      const cwm = new ContextWindowManager(db, registry, { summarizationThreshold: 10 });
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "s1",
        summary: "Custom threshold summary",
        messageCount: 12,
      });

      const result = await cwm.prepareHistory("conv-1", history);
      expect(result.wasSummarized).toBe(true);
      expect(result.messages[0].content).toContain("Custom threshold summary");
    });

    it("respects custom staleSummaryDelta", async () => {
      mockGetConversationMessageCount.mockResolvedValue(40);
      const history = makeHistory(10);

      // With staleSummaryDelta of 20, a summary at 30 (delta=10) is NOT stale
      const cwm = new ContextWindowManager(db, registry, { staleSummaryDelta: 20 });
      mockGetLatestConversationSummary.mockResolvedValue({
        id: "s1",
        summary: "Still fresh summary",
        messageCount: 30, // 40 - 30 = 10 < 20
      });

      const result = await cwm.prepareHistory("conv-1", history);
      expect(result.wasSummarized).toBe(true);
      expect(mockComplete).not.toHaveBeenCalled(); // Used cached
    });
  });
});
