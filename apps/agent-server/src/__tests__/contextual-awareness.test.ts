import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockGetRecentUserActionSummary = vi.fn();
const mockListActiveGoals = vi.fn();
const mockListPendingApprovals = vi.fn();
const mockGetTriggeredPatterns = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getRecentUserActionSummary: (...args: unknown[]) => mockGetRecentUserActionSummary(...args),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  getTriggeredPatterns: (...args: unknown[]) => mockGetTriggeredPatterns(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { ContextualAwarenessService } = await import("../services/contextual-awareness.js");

const mockDb = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockListActiveGoals.mockResolvedValue([]);
  mockListPendingApprovals.mockResolvedValue([]);
  mockGetRecentUserActionSummary.mockResolvedValue([]);
  mockGetTriggeredPatterns.mockResolvedValue([]);
});

describe("ContextualAwarenessService", () => {
  describe("classifyTimePeriod", () => {
    it("classifies early morning (6-8)", () => {
      const service = new ContextualAwarenessService(mockDb);
      expect(service.classifyTimePeriod(6)).toBe("early_morning");
      expect(service.classifyTimePeriod(8)).toBe("early_morning");
    });

    it("classifies morning (9-11)", () => {
      const service = new ContextualAwarenessService(mockDb);
      expect(service.classifyTimePeriod(9)).toBe("morning");
      expect(service.classifyTimePeriod(11)).toBe("morning");
    });

    it("classifies afternoon (12-16)", () => {
      const service = new ContextualAwarenessService(mockDb);
      expect(service.classifyTimePeriod(12)).toBe("afternoon");
      expect(service.classifyTimePeriod(16)).toBe("afternoon");
    });

    it("classifies evening (17-20)", () => {
      const service = new ContextualAwarenessService(mockDb);
      expect(service.classifyTimePeriod(17)).toBe("evening");
      expect(service.classifyTimePeriod(20)).toBe("evening");
    });

    it("classifies late night (21-5)", () => {
      const service = new ContextualAwarenessService(mockDb);
      expect(service.classifyTimePeriod(21)).toBe("late_night");
      expect(service.classifyTimePeriod(0)).toBe("late_night");
      expect(service.classifyTimePeriod(3)).toBe("late_night");
      expect(service.classifyTimePeriod(5)).toBe("late_night");
    });
  });

  describe("getContextBlock", () => {
    it("returns a context block with time info", async () => {
      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock();

      expect(result).not.toBeNull();
      expect(result).toContain("## Current Context");
      expect(result).toContain("**Time:**");
      expect(result).toContain("**Period:**");
      expect(result).toContain("**Tone:**");
    });

    it("includes recent activity when user has actions", async () => {
      mockGetRecentUserActionSummary.mockResolvedValueOnce([
        { actionType: "chat_message", count: 5 },
        { actionType: "goal_created", count: 2 },
      ]);

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      expect(result).toContain("**Recent activity (2h):**");
      expect(result).toContain("chat message (5)");
      expect(result).toContain("goal created (2)");
    });

    it("includes active goals and pending approvals count", async () => {
      mockListActiveGoals.mockResolvedValueOnce([
        { id: "g-1", title: "Goal 1" },
        { id: "g-2", title: "Goal 2" },
      ]);
      mockListPendingApprovals.mockResolvedValueOnce([
        { id: "a-1" },
      ]);

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock();

      expect(result).toContain("2 active goal(s)");
      expect(result).toContain("1 pending approval(s)");
    });

    it("includes triggered patterns", async () => {
      mockGetTriggeredPatterns.mockResolvedValueOnce([
        { id: "p-1", suggestedAction: "Run the test suite before deploying" },
      ]);

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      expect(result).toContain("**Suggestions based on your patterns:**");
      expect(result).toContain("Run the test suite before deploying");
    });

    it("limits patterns to 3", async () => {
      mockGetTriggeredPatterns.mockResolvedValueOnce([
        { id: "p-1", suggestedAction: "Pattern 1" },
        { id: "p-2", suggestedAction: "Pattern 2" },
        { id: "p-3", suggestedAction: "Pattern 3" },
        { id: "p-4", suggestedAction: "Pattern 4" },
      ]);

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      expect(result).toContain("Pattern 1");
      expect(result).toContain("Pattern 3");
      expect(result).not.toContain("Pattern 4");
    });

    it("omits activity section when no actions", async () => {
      mockGetRecentUserActionSummary.mockResolvedValueOnce([]);

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      expect(result).not.toContain("**Recent activity");
    });

    it("uses custom timezone", async () => {
      const service = new ContextualAwarenessService(mockDb, { timezone: "Europe/London" });
      const result = await service.getContextBlock();

      expect(result).toContain("Europe/London");
    });

    it("returns null when everything fails", async () => {
      const service = new ContextualAwarenessService(mockDb);
      // Force a top-level failure by making Intl throw
      const origFormat = Intl.DateTimeFormat;
      vi.stubGlobal("Intl", { DateTimeFormat: () => { throw new Error("boom"); } });

      const result = await service.getContextBlock();
      expect(result).toBeNull();

      vi.stubGlobal("Intl", { DateTimeFormat: origFormat });
    });

    it("gracefully handles DB errors for action summary", async () => {
      mockGetRecentUserActionSummary.mockRejectedValueOnce(new Error("db error"));

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      // Should still return a context block, just without activity
      expect(result).toContain("## Current Context");
      expect(result).not.toContain("**Recent activity");
    });

    it("gracefully handles DB errors for goals/approvals", async () => {
      mockListActiveGoals.mockRejectedValueOnce(new Error("db error"));

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock();

      expect(result).toContain("## Current Context");
      expect(result).not.toContain("**Status:**");
    });

    it("gracefully handles DB errors for patterns", async () => {
      mockGetTriggeredPatterns.mockRejectedValueOnce(new Error("db error"));

      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock("user-1");

      expect(result).toContain("## Current Context");
      expect(result).not.toContain("**Suggestions");
    });

    it("skips patterns section when no userId", async () => {
      const service = new ContextualAwarenessService(mockDb);
      const result = await service.getContextBlock();

      expect(mockGetTriggeredPatterns).not.toHaveBeenCalled();
      expect(result).not.toContain("**Suggestions");
    });
  });
});
