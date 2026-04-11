import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

const mockCreateJournalEntry = vi.fn().mockResolvedValue({ id: "je-1" });
const mockListJournalEntries = vi.fn().mockResolvedValue({ data: [], total: 0 });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createJournalEntry: (...args: unknown[]) => mockCreateJournalEntry(...args),
  listJournalEntries: (...args: unknown[]) => mockListJournalEntries(...args),
}));

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

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Today we completed 3 goals and created 2 PRs." }],
      model: "test",
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry };
});

const { createJournalService } = await import("../services/journal.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

describe("JournalService", () => {
  let service: ReturnType<typeof createJournalService>;
  let registry: InstanceType<typeof LlmRegistry>;
  const mockEmit = vi.fn();
  const mockEvents = { emit: mockEmit } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new LlmRegistry();
    service = createJournalService({} as never, registry, mockEvents);
  });

  describe("writeEntry", () => {
    it("creates a journal entry and emits WS event", async () => {
      await service.writeEntry({
        entryType: "goal_completed",
        title: "Goal finished",
        goalId: "g-1",
      });

      expect(mockCreateJournalEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          entryType: "goal_completed",
          title: "Goal finished",
          goalId: "g-1",
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith("ws:journal_change");
    });

    it("does not throw if entry creation fails", async () => {
      mockCreateJournalEntry.mockRejectedValueOnce(new Error("DB error"));

      await expect(
        service.writeEntry({ entryType: "work_session", title: "Test" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("generateStandup", () => {
    it("returns 'no activity' for empty day", async () => {
      mockListJournalEntries.mockResolvedValueOnce({ data: [], total: 0 });

      const result = await service.generateStandup(new Date("2024-01-15"));

      expect(result.date).toBe("2024-01-15");
      expect(result.narrative).toContain("No activity");
      expect(result.data.totalEntries).toBe(0);
    });

    it("generates LLM narrative for non-empty day", async () => {
      mockListJournalEntries.mockResolvedValueOnce({
        data: [
          {
            id: "je-1",
            entryType: "goal_completed",
            title: "Built feature",
            summary: "Added auth",
          },
          { id: "je-2", entryType: "pr_created", title: "PR #42", summary: "Auth PR" },
        ],
        total: 2,
      });

      const result = await service.generateStandup(new Date("2024-01-15"));

      expect(result.date).toBe("2024-01-15");
      expect(result.narrative).toBe("Today we completed 3 goals and created 2 PRs.");
      expect(result.data.entryCounts).toEqual({ goal_completed: 1, pr_created: 1 });
      expect(result.data.totalEntries).toBe(2);
    });

    it("falls back to static format on LLM failure", async () => {
      mockListJournalEntries.mockResolvedValueOnce({
        data: [{ id: "je-1", entryType: "work_session", title: "Session", summary: "Did stuff" }],
        total: 1,
      });
      (registry.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("LLM unavailable"),
      );

      const result = await service.generateStandup(new Date("2024-01-15"));

      expect(result.date).toBe("2024-01-15");
      expect(result.narrative).toContain("Activity for 2024-01-15");
      expect(result.narrative).toContain("work session: 1");
    });

    it("includes highlights from entry summaries", async () => {
      mockListJournalEntries.mockResolvedValueOnce({
        data: [
          { id: "je-1", entryType: "git_commit", title: "Commit", summary: "Fixed login bug" },
          { id: "je-2", entryType: "git_commit", title: "Commit", summary: null },
        ],
        total: 2,
      });

      const result = await service.generateStandup(new Date("2024-01-15"));

      expect(result.data.highlights).toEqual(["Fixed login bug"]);
    });
  });
});
