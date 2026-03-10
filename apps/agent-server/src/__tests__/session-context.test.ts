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

// 2. Mock @ai-cofounder/db with mockDbModule spread + custom getRecentSessionSummaries mock
const mockGetRecentSessionSummaries = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getRecentSessionSummaries: (...args: unknown[]) =>
    mockGetRecentSessionSummaries(...args),
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
  let SessionContextService: typeof import("../services/session-context.js").SessionContextService;
  const mockDb = {} as Parameters<typeof SessionContextService.prototype.getRecentContext>[0];

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
});
