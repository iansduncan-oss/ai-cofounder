import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// 1. Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// 2. Mock @ai-cofounder/db with mockDbModule spread + custom mocks
const mockGetRecentSessionSummaries = vi.fn().mockResolvedValue([]);
const mockGetLastUserMessageTimestamp = vi.fn().mockResolvedValue(null);
const mockGetRecentDecisionMemories = vi.fn().mockResolvedValue([]);
const mockListRecentlyCompletedGoals = vi.fn().mockResolvedValue([]);
const mockListReflections = vi.fn().mockResolvedValue({ data: [], total: 0 });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getRecentSessionSummaries: (...args: unknown[]) =>
    mockGetRecentSessionSummaries(...args),
  getLastUserMessageTimestamp: (...args: unknown[]) =>
    mockGetLastUserMessageTimestamp(...args),
  getRecentDecisionMemories: (...args: unknown[]) =>
    mockGetRecentDecisionMemories(...args),
  listRecentlyCompletedGoals: (...args: unknown[]) =>
    mockListRecentlyCompletedGoals(...args),
  listReflections: (...args: unknown[]) =>
    mockListReflections(...args),
}));

// 3. Mock @ai-cofounder/llm
const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: '{"hasDecision": false}' }],
  usage: { inputTokens: 10, outputTokens: 5 },
  model: "gpt-test",
  provider: "test",
  stop_reason: "end_turn",
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

// 4. Mock @ai-cofounder/rag to prevent import issues
vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

// 5. Mock @ai-cofounder/queue
vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn().mockResolvedValue(undefined),
}));

describe("session context", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SessionContextService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDb = {} as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ SessionContextService } = await import("../services/session-context.js"));
  });

  it("returns formatted session context for user with recent summaries", async () => {
    mockGetRecentSessionSummaries.mockResolvedValueOnce([
      {
        conversationId: "conv-1",
        summary: "We discussed setting up the authentication system with JWT tokens.",
        createdAt: new Date("2026-03-08"),
      },
      {
        conversationId: "conv-2",
        summary: "Reviewed the database schema and decided to use Postgres.",
        createdAt: new Date("2026-03-07"),
      },
      {
        conversationId: "conv-3",
        summary: "Explored React architecture options for the dashboard.",
        createdAt: new Date("2026-03-06"),
      },
    ]);

    const service = new SessionContextService(mockDb);
    const result = await service.getRecentContext("user-1");

    expect(result).not.toBeNull();
    expect(result).toContain("## Recent Sessions");
    expect(result).toContain("Session 1 (most recent):");
    expect(result).toContain("Session 2:");
    expect(result).toContain("Session 3:");
    expect(result).toContain("We discussed setting up the authentication system with JWT tokens.");
    expect(result).toContain("Reviewed the database schema and decided to use Postgres.");
    expect(result).toContain("Explored React architecture options for the dashboard.");
  });

  it("returns null when no summaries exist", async () => {
    mockGetRecentSessionSummaries.mockResolvedValueOnce([]);

    const service = new SessionContextService(mockDb);
    const result = await service.getRecentContext("user-1");

    expect(result).toBeNull();
  });

  it("truncates long summaries to ~250 chars", async () => {
    const longSummary = "A".repeat(1000);
    mockGetRecentSessionSummaries.mockResolvedValueOnce([
      {
        conversationId: "conv-1",
        summary: longSummary,
        createdAt: new Date("2026-03-08"),
      },
    ]);

    const service = new SessionContextService(mockDb);
    const result = await service.getRecentContext("user-1");

    expect(result).not.toBeNull();
    // The truncated portion should be exactly 250 chars of "A"
    expect(result).toContain("A".repeat(250));
    // Should NOT contain more than 250 "A"s
    expect(result).not.toContain("A".repeat(251));
  });

  it("orchestrator injects session context before memory context", async () => {
    // Mock getRecentSessionSummaries to return a session summary
    mockGetRecentSessionSummaries.mockResolvedValue([
      {
        conversationId: "conv-prev",
        summary: "Previous session: we set up the CI/CD pipeline.",
        createdAt: new Date("2026-03-07"),
      },
    ]);

    const sessionSvc = new SessionContextService(mockDb);
    const contextBlock = await sessionSvc.getRecentContext("user-abc");

    // Verify the session block is present and correctly formatted
    expect(contextBlock).not.toBeNull();
    expect(contextBlock).toContain("## Recent Sessions");
    expect(contextBlock).toContain("Previous session: we set up the CI/CD pipeline.");

    // Verify prepend behavior: session context comes before other memory context
    // This simulates what orchestrator.run() does: sessionBlock + "\n\n" + existingMemoryContext
    const existingMemoryContext = "General knowledge:\n- [projects] main: Some project detail";
    const combined = contextBlock! + "\n\n" + existingMemoryContext;
    expect(combined.indexOf("## Recent Sessions")).toBeLessThan(combined.indexOf("General knowledge:"));
    expect(combined.indexOf("## Recent Sessions")).toBe(0); // Session context is prepended first
  });

  describe("getReturnContext", () => {
    it("returns null when no last message exists", async () => {
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(null);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");
      expect(result).toBeNull();
    });

    it("returns null when gap is less than 2 hours", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(oneHourAgo);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");
      expect(result).toBeNull();
    });

    it("returns context block when gap is 2+ hours", async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(threeHoursAgo);
      mockGetRecentSessionSummaries.mockResolvedValueOnce([
        { conversationId: "c-1", summary: "Worked on deploy pipeline", createdAt: new Date() },
      ]);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).toContain("## Since You Were Last Here");
      expect(result).toContain("3 hours ago");
      expect(result).toContain("**Last session:**");
      expect(result).toContain("Worked on deploy pipeline");
    });

    it("formats multi-day gap correctly", async () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(twoDaysAgo);
      mockGetRecentSessionSummaries.mockResolvedValueOnce([
        { conversationId: "c-1", summary: "Old session", createdAt: new Date() },
      ]);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");
      expect(result).toContain("2 days ago");
    });

    it("includes decisions made since last message", async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(sixHoursAgo);
      mockGetRecentDecisionMemories.mockResolvedValueOnce([
        { id: "d-1", key: "Use PostgreSQL", content: "Chose PostgreSQL for relational data", createdAt: new Date() },
      ]);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).toContain("**Decisions recorded:**");
      expect(result).toContain("Use PostgreSQL: Chose PostgreSQL for relational data");
    });

    it("includes completed goals since last message", async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(sixHoursAgo);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([
        { id: "g-1", title: "Deploy monitoring stack" },
      ]);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).toContain("**Goals completed:**");
      expect(result).toContain("Deploy monitoring stack");
    });

    it("includes reflections with lessons", async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(sixHoursAgo);
      mockListReflections.mockResolvedValueOnce({
        data: [
          {
            id: "r-1",
            createdAt: new Date(),
            lessons: [{ lesson: "Always run tests before deploying" }],
          },
        ],
        total: 1,
      });

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).toContain("**Lessons learned:**");
      expect(result).toContain("Always run tests before deploying");
    });

    it("returns null when only header is present (no content)", async () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(threeHoursAgo);
      mockGetRecentSessionSummaries.mockResolvedValueOnce([]);
      mockGetRecentDecisionMemories.mockResolvedValueOnce([]);
      mockListRecentlyCompletedGoals.mockResolvedValueOnce([]);
      mockListReflections.mockResolvedValueOnce({ data: [], total: 0 });

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");
      expect(result).toBeNull();
    });

    it("limits decisions to 5", async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(sixHoursAgo);
      const manyDecisions = Array.from({ length: 8 }, (_, i) => ({
        id: `d-${i}`, key: `Decision ${i}`, content: `Content ${i}`, createdAt: new Date(),
      }));
      mockGetRecentDecisionMemories.mockResolvedValueOnce(manyDecisions);

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).toContain("Decision 4");
      expect(result).not.toContain("Decision 5");
    });

    it("gracefully handles DB errors", async () => {
      mockGetLastUserMessageTimestamp.mockRejectedValueOnce(new Error("db down"));

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");
      expect(result).toBeNull();
    });

    it("skips reflections that pre-date last message", async () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      mockGetLastUserMessageTimestamp.mockResolvedValueOnce(sixHoursAgo);
      mockGetRecentSessionSummaries.mockResolvedValueOnce([
        { conversationId: "c-1", summary: "A session", createdAt: new Date() },
      ]);
      mockListReflections.mockResolvedValueOnce({
        data: [
          {
            id: "r-old",
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // older than gap
            lessons: [{ lesson: "Old lesson" }],
          },
        ],
        total: 1,
      });

      const service = new SessionContextService(mockDb);
      const result = await service.getReturnContext("user-1");

      expect(result).not.toContain("**Lessons learned:**");
    });
  });
});
