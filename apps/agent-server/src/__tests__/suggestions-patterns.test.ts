import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock DB ──

const mockGetTriggeredPatterns = vi.fn().mockResolvedValue([]);
const mockIncrementPatternHitCount = vi.fn().mockResolvedValue({ id: "up-1" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getTriggeredPatterns: (...args: unknown[]) => mockGetTriggeredPatterns(...args),
  incrementPatternHitCount: (...args: unknown[]) => mockIncrementPatternHitCount(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Mock LLM ──

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
  return { LlmRegistry: MockLlmRegistry };
});

// Mock briefing data
vi.mock("../services/briefing.js", () => ({
  gatherBriefingData: vi.fn().mockResolvedValue({
    activeGoals: [],
    staleGoalCount: 0,
    pendingApprovalCount: 0,
    taskBreakdown: { pending: 0 },
  }),
}));

const { generateSuggestions } = await import("../services/suggestions.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateSuggestions (pattern-aware)", () => {
  const db = {} as any;
  const registry = { complete: mockComplete } as any;

  it("works without userId (backward compatible)", async () => {
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Check goals", "Run tests"]' }],
    });

    const result = await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi there!",
    });

    expect(result).toEqual(["Check goals", "Run tests"]);
    expect(mockGetTriggeredPatterns).not.toHaveBeenCalled();
  });

  it("queries patterns when userId is provided", async () => {
    mockGetTriggeredPatterns.mockResolvedValue([]);
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Suggestion 1"]' }],
    });

    await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi!",
      userId: "user-1",
    });

    expect(mockGetTriggeredPatterns).toHaveBeenCalledOnce();
    expect(mockGetTriggeredPatterns.mock.calls[0][1]).toBe("user-1");
  });

  it("includes pattern context in LLM prompt when patterns exist", async () => {
    mockGetTriggeredPatterns.mockResolvedValue([
      {
        id: "p-1",
        description: "Deploys on Fridays",
        suggestedAction: "Run test suite first",
        confidence: 80,
        triggerCondition: { dayOfWeek: 5 },
      },
    ]);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Run test suite first", "Check CI status"]' }],
    });

    const result = await generateSuggestions(db, registry, {
      userMessage: "Let's deploy",
      agentResponse: "Ready to deploy",
      userId: "user-1",
    });

    // Verify the LLM prompt includes pattern info
    const promptText = mockComplete.mock.calls[0][1].messages[0].content[0].text;
    expect(promptText).toContain("Deploys on Fridays");
    expect(promptText).toContain("Run test suite first");
    expect(promptText).toContain("behavioral patterns");
    expect(result).toHaveLength(2);
  });

  it("still works when pattern lookup fails", async () => {
    mockGetTriggeredPatterns.mockRejectedValue(new Error("DB error"));
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Fallback suggestion"]' }],
    });

    const result = await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi!",
      userId: "user-1",
    });

    expect(result).toEqual(["Fallback suggestion"]);
  });

  it("returns empty array on invalid LLM response", async () => {
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "I cannot generate suggestions right now." }],
    });

    const result = await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi!",
    });

    expect(result).toEqual([]);
  });

  it("limits to 3 suggestions max", async () => {
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["A", "B", "C", "D", "E"]' }],
    });

    const result = await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi!",
    });

    expect(result).toHaveLength(3);
  });

  it("handles multiple patterns in prompt", async () => {
    mockGetTriggeredPatterns.mockResolvedValue([
      {
        id: "p-1",
        description: "Active in mornings",
        suggestedAction: "Review overnight alerts",
        confidence: 70,
        triggerCondition: { hourRange: [8, 12] },
      },
      {
        id: "p-2",
        description: "Usually checks CI on Mondays",
        suggestedAction: "Check CI pipeline status",
        confidence: 60,
        triggerCondition: { dayOfWeek: 1, hourRange: [9, 11] },
      },
    ]);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Review overnight alerts", "Check CI pipeline status"]' }],
    });

    await generateSuggestions(db, registry, {
      userMessage: "Good morning",
      agentResponse: "Good morning!",
      userId: "user-1",
    });

    const promptText = mockComplete.mock.calls[0][1].messages[0].content[0].text;
    expect(promptText).toContain("Active in mornings");
    expect(promptText).toContain("Usually checks CI on Mondays");
  });

  it("increments hitCount for each triggered pattern", async () => {
    mockGetTriggeredPatterns.mockResolvedValue([
      {
        id: "p-1",
        description: "Morning user",
        suggestedAction: "Check alerts",
        confidence: 80,
        triggerCondition: { hourRange: [8, 12] },
      },
      {
        id: "p-2",
        description: "Monday deployer",
        suggestedAction: "Run tests",
        confidence: 60,
        triggerCondition: { dayOfWeek: 1 },
      },
    ]);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: '["Check alerts"]' }],
    });

    await generateSuggestions(db, registry, {
      userMessage: "Hello",
      agentResponse: "Hi!",
      userId: "user-1",
    });

    expect(mockIncrementPatternHitCount).toHaveBeenCalledTimes(2);
    expect(mockIncrementPatternHitCount).toHaveBeenCalledWith(db, "p-1");
    expect(mockIncrementPatternHitCount).toHaveBeenCalledWith(db, "p-2");
  });
});
