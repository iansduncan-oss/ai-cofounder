import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// Set env before any imports
beforeAll(() => {
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client-id";
  process.env.AGENT_SERVER_URL = "http://localhost:3100";
});

// Mock discord.js EmbedBuilder
vi.mock("discord.js", () => {
  class MockEmbedBuilder {
    data: Record<string, unknown> = {};
    setColor(color: number) {
      this.data.color = color;
      return this;
    }
    setTitle(title: string) {
      this.data.title = title;
      return this;
    }
    setDescription(desc: string) {
      this.data.description = desc;
      return this;
    }
    setFooter(footer: { text: string }) {
      this.data.footer = footer;
      return this;
    }
    addFields(...fields: unknown[]) {
      this.data.fields = fields;
      return this;
    }
  }

  return { EmbedBuilder: MockEmbedBuilder };
});

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (name: string, defaultValue: string) => process.env[name] ?? defaultValue,
}));

function mockInteraction(commandName: string, options: Record<string, string | number> = {}) {
  const mockMessage = { startThread: vi.fn().mockResolvedValue({}) };
  return {
    isChatInputCommand: () => true,
    commandName,
    channelId: "test-channel-123",
    user: { id: `user-${Math.random().toString(36).slice(2)}`, username: "testuser" },
    options: {
      getString: (name: string, _required?: boolean) => options[name] ?? null,
      getInteger: (name: string) => (name in options ? Number(options[name]) : null),
      getSubcommand: () => options._subcommand ?? null,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    fetchReply: vi.fn().mockResolvedValue(mockMessage),
  };
}

const { handleInteraction } = await import("../handlers/interaction.js");

describe("extended interaction handlers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("handleReject", () => {
    it("rejects and shows success embed", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ id: "a1", status: "rejected" }),
      });

      const interaction = mockInteraction("reject", { approval_id: "a1" });
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0xef4444,
              description: expect.stringContaining("rejected"),
            }),
          }),
        ],
      });
    });

    it("shows error on rejection failure", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Already resolved" }),
      });

      const interaction = mockInteraction("reject", { approval_id: "a1" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to reject"),
      });
    });
  });

  describe("handleListApprovals", () => {
    it("shows pending approvals list", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [
          {
            id: "ap-1",
            taskId: "task-1",
            requestedBy: "orchestrator",
            reason: "Budget exceeded threshold",
            createdAt: "2026-01-01T00:00:00Z",
          },
          {
            id: "ap-2",
            taskId: "task-2",
            requestedBy: "coder",
            reason: "Deploy to production",
            createdAt: "2026-01-01T01:00:00Z",
          },
        ],
      });

      const interaction = mockInteraction("approvals");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0xf59e0b,
              title: "Pending Approvals",
            }),
          }),
        ],
      });
    });

    it("shows empty message when no pending approvals", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [],
      });

      const interaction = mockInteraction("approvals");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No pending approvals"),
      });
    });

    it("shows error when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const interaction = mockInteraction("approvals");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch pending approvals"),
      });
    });
  });

  describe("handleBudget", () => {
    it("shows budget status with green color when under threshold", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          daily: { spentUsd: 0.5, limitUsd: 10.0, percentUsed: 5 },
          weekly: { spentUsd: 3.2, limitUsd: 50.0, percentUsed: 6.4 },
          optimizationSuggestions: [],
        }),
      });

      const interaction = mockInteraction("budget");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x22c55e,
              title: "Budget Status",
            }),
          }),
        ],
      });
    });

    it("shows budget status with red color when over 80%", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          daily: { spentUsd: 9.0, limitUsd: 10.0, percentUsed: 90 },
          weekly: { spentUsd: 45.0, limitUsd: 50.0, percentUsed: 90 },
          optimizationSuggestions: ["Consider using cheaper models for simple tasks"],
        }),
      });

      const interaction = mockInteraction("budget");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0xef4444,
              title: "Budget Status",
            }),
          }),
        ],
      });
    });

    it("shows error when budget fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      const interaction = mockInteraction("budget");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch budget"),
      });
    });
  });

  describe("handleErrors", () => {
    it("shows error summary", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          hours: 24,
          totalErrors: 5,
          errors: [
            { toolName: "search_web", errorMessage: "Timeout", count: 3 },
            { toolName: "execute_code", errorMessage: "Sandbox unavailable", count: 2 },
          ],
        }),
      });

      const interaction = mockInteraction("errors");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0xef4444,
              title: expect.stringContaining("Errors"),
            }),
          }),
        ],
      });
    });

    it("shows no errors message when clean", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          hours: 24,
          totalErrors: 0,
          errors: [],
        }),
      });

      const interaction = mockInteraction("errors");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No errors"),
      });
    });

    it("shows error when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const interaction = mockInteraction("errors");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch error summary"),
      });
    });
  });

  describe("handleStandup", () => {
    it("shows standup report", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          date: "2026-04-01",
          narrative: "Today the team completed 3 goals and started 2 new ones. Budget usage is on track.",
          data: { totalEntries: 12, costUsd: 0.0342 },
        }),
      });

      const interaction = mockInteraction("standup");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x7c3aed,
              title: expect.stringContaining("Standup"),
            }),
          }),
        ],
      });
    });

    it("passes date option when provided", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          date: "2026-03-31",
          narrative: "Yesterday was a quiet day.",
          data: { totalEntries: 3, costUsd: 0.012 },
        }),
      });

      const interaction = mockInteraction("standup", { date: "2026-03-31" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining("2026-03-31"),
            }),
          }),
        ],
      });
    });

    it("shows error when standup fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Server error"),
      );

      const interaction = mockInteraction("standup");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch standup"),
      });
    });
  });

  describe("handleFollowUps", () => {
    it("shows follow-ups list", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          data: [
            { id: "fu-1", title: "Review PR #42", status: "pending", dueDate: "2026-04-02" },
            { id: "fu-2", title: "Update docs", status: "done", dueDate: null },
          ],
          total: 2,
          limit: 15,
          offset: 0,
        }),
      });

      const interaction = mockInteraction("followups");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0xf59e0b,
              title: "Follow-Ups",
            }),
          }),
        ],
      });
    });

    it("shows empty message when no follow-ups", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          data: [],
          total: 0,
          limit: 15,
          offset: 0,
        }),
      });

      const interaction = mockInteraction("followups");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No follow-ups"),
      });
    });

    it("shows error when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const interaction = mockInteraction("followups");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch follow-ups"),
      });
    });
  });

  describe("handleSearch", () => {
    it("shows search results across multiple types", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          goals: [{ id: "g1", title: "Build MVP", status: "active" }],
          tasks: [{ id: "t1", title: "Research competitors", status: "pending" }],
          conversations: [{ id: "c1", title: "Strategy discussion" }],
          memories: [{ key: "preference", content: "TypeScript", category: "preferences" }],
        }),
      });

      const interaction = mockInteraction("search", { query: "MVP" });
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x7c3aed,
              title: "Search Results",
            }),
          }),
        ],
      });
    });

    it("shows no results message when search is empty", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          goals: [],
          tasks: [],
          conversations: [],
          memories: [],
        }),
      });

      const interaction = mockInteraction("search", { query: "nonexistent" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No results"),
      });
    });

    it("shows error when search fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Search service down"),
      );

      const interaction = mockInteraction("search", { query: "test" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Search failed"),
      });
    });
  });

  describe("handleAnalytics", () => {
    it("shows goal analytics", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          totalGoals: 10,
          completionRate: 60.0,
          taskSuccessRate: 85.5,
          totalTasks: 45,
          byStatus: { active: 3, completed: 6, draft: 1 },
        }),
      });

      const interaction = mockInteraction("analytics");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x7c3aed,
              title: "Goal Analytics",
            }),
          }),
        ],
      });
    });

    it("shows error when analytics fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Analytics unavailable"),
      );

      const interaction = mockInteraction("analytics");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch analytics"),
      });
    });
  });

  describe("handleHelp", () => {
    it("shows help with command list", async () => {
      const interaction = mockInteraction("help");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x7c3aed,
              title: "AI Cofounder — Commands",
            }),
          }),
        ],
      });
    });
  });

  describe("handleScheduleList", () => {
    it("shows schedules list", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [
          {
            id: "sched-1",
            cronExpression: "0 9 * * *",
            description: "Daily standup generation",
            actionPrompt: "Generate standup",
            enabled: true,
            nextRunAt: "2026-04-02T09:00:00Z",
          },
          {
            id: "sched-2",
            cronExpression: "0 */6 * * *",
            description: "Health check",
            actionPrompt: "Run health check",
            enabled: false,
            nextRunAt: "2026-04-01T18:00:00Z",
          },
        ],
      });

      const interaction = mockInteraction("schedule", { _subcommand: "list" });
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x7c3aed,
              title: "Schedules",
            }),
          }),
        ],
      });
    });

    it("shows empty message when no schedules", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [],
      });

      const interaction = mockInteraction("schedule", { _subcommand: "list" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No schedules"),
      });
    });

    it("shows error when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      const interaction = mockInteraction("schedule", { _subcommand: "list" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to fetch schedules"),
      });
    });
  });

  describe("handleScheduleCreate", () => {
    it("creates schedule and shows success embed", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          id: "sched-new",
          cronExpression: "30 8 * * 1-5",
          description: "Weekday morning briefing",
          enabled: true,
        }),
      });

      const interaction = mockInteraction("schedule", {
        _subcommand: "create",
        cron: "30 8 * * 1-5",
        task: "Weekday morning briefing",
      });
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x22c55e,
              title: "Schedule Created",
            }),
          }),
        ],
      });
    });

    it("shows error when schedule creation fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Invalid cron"),
      );

      const interaction = mockInteraction("schedule", {
        _subcommand: "create",
        cron: "invalid",
        task: "Bad schedule",
      });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to create schedule"),
      });
    });
  });
});
