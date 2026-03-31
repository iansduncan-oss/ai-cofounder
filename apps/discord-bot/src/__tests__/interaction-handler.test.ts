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

function mockInteraction(commandName: string, options: Record<string, string> = {}) {
  const mockMessage = { startThread: vi.fn().mockResolvedValue({}) };
  return {
    isChatInputCommand: () => true,
    commandName,
    channelId: "test-channel-123",
    user: { id: `user-${Math.random().toString(36).slice(2)}`, username: "testuser" },
    options: {
      getString: (name: string, _required?: boolean) => options[name] ?? null,
      getSubcommand: () => options._subcommand ?? null,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    fetchReply: vi.fn().mockResolvedValue(mockMessage),
  };
}

const { handleInteraction } = await import("../handlers/interaction.js");

describe("interaction handler — comprehensive", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("cooldown enforcement", () => {
    it("allows first command without cooldown", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: "ok", timestamp: "2026-01-01T00:00:00Z", uptime: 3600 }),
      });

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled(); // No cooldown reply
      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("skips cooldown for help command", async () => {
      // Call help rapidly — should never get cooldown
      for (let i = 0; i < 3; i++) {
        const interaction = mockInteraction("help");
        // Use same user ID to test cooldown
        interaction.user.id = "cooldown-test-user-help";
        await handleInteraction(interaction as never);
        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      }
    });
  });

  describe("command routing", () => {
    it("routes 'status' to handleStatus", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: "ok", timestamp: "2026-01-01T00:00:00Z", uptime: 3600 }),
      });

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x22c55e,
              title: "AI Cofounder \u2014 System Status",
            }),
          }),
        ],
      });
    });

    it("routes 'goals' to handleGoals", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => ({ conversationId: "conv-1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => ({
            data: [{ id: "g1", title: "Test Goal", status: "active", priority: "high" }],
            total: 1, limit: 50, offset: 0,
          }),
        });

      const interaction = mockInteraction("goals");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: "Goals" }),
          }),
        ],
      });
    });

    it("routes 'tasks' to handleTasks", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [{ id: "t1", title: "Task 1", status: "pending", assignedAgent: "coder" }],
      });

      const interaction = mockInteraction("tasks");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: "Pending Tasks" }),
          }),
        ],
      });
    });

    it("routes 'memory' to handleMemory with ephemeral defer", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Not found" }),
      });

      const interaction = mockInteraction("memory");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("routes 'clear' to handleClear", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ deleted: true }),
      });

      const interaction = mockInteraction("clear");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("Conversation cleared"),
            }),
          }),
        ],
      });
    });

    it("routes 'approve' to handleApprove", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ id: "a1", status: "approved" }),
      });

      const interaction = mockInteraction("approve", { approval_id: "a1" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("approved"),
            }),
          }),
        ],
      });
    });

    it("routes 'help' to handleHelp with ephemeral", async () => {
      const interaction = mockInteraction("help");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: "AI Cofounder \u2014 Commands",
            }),
          }),
        ],
      });
    });

    it("routes 'register' to handleRegister with ephemeral", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ id: "u1", displayName: "TestUser", isNew: true }),
      });

      const interaction = mockInteraction("register");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("Welcome"),
            }),
          }),
        ],
      });
    });

    it("routes 'schedule list' to handleScheduleList", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ([
          { id: "s1", cronExpression: "0 9 * * *", description: "Daily", enabled: true, nextRunAt: "2026-04-01T09:00:00Z" },
        ]),
      });

      const interaction = mockInteraction("schedule", { _subcommand: "list" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: "Schedules" }),
          }),
        ],
      });
    });

    it("routes 'schedule create' to handleScheduleCreate", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ id: "s2", cronExpression: "0 9 * * 1-5", description: "Weekday task" }),
      });

      const interaction = mockInteraction("schedule", {
        _subcommand: "create",
        cron: "0 9 * * 1-5",
        task: "Weekday briefing",
      });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: "Schedule Created" }),
          }),
        ],
      });
    });

    it("routes 'gmail inbox' to handleGmailInbox", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          messages: [
            { from: "test@example.com", subject: "Hello", date: "2026-03-30", isUnread: true },
          ],
          unreadCount: 1,
        }),
      });

      const interaction = mockInteraction("gmail", { _subcommand: "inbox" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: "Gmail Inbox" }),
          }),
        ],
      });
    });

    it("routes 'gmail send' to handleGmailSend", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ success: true }),
      });

      const interaction = mockInteraction("gmail", {
        _subcommand: "send",
        to: "test@example.com",
        subject: "Test Subject",
        body: "Test body",
      });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("Email sent"),
            }),
          }),
        ],
      });
    });
  });

  describe("unknown commands", () => {
    it("returns without reply for unknown commands", async () => {
      const interaction = mockInteraction("nonexistent_cmd");
      await handleInteraction(interaction as never);

      // Unknown commands just get deferred but no editReply is called
      // Actually, from the source code, unknown commands don't deferReply at all
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe("non-command interactions", () => {
    it("ignores non-chat-input interactions", async () => {
      const interaction = {
        isChatInputCommand: () => false,
      };

      // Should return without error
      await handleInteraction(interaction as never);
    });
  });

  describe("sendDiscordResponse formatting", () => {
    it("formats status embed with green color and fields", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: "ok", timestamp: "2026-01-01T00:00:00Z", uptime: 7200 }),
      });

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      const editCall = interaction.editReply.mock.calls[0][0];
      expect(editCall.embeds[0].data.color).toBe(0x22c55e);
      expect(editCall.embeds[0].data.title).toBe("AI Cofounder \u2014 System Status");
    });

    it("formats help embed with command list", async () => {
      const interaction = mockInteraction("help");
      await handleInteraction(interaction as never);

      const editCall = interaction.editReply.mock.calls[0][0];
      expect(editCall.embeds[0].data.title).toBe("AI Cofounder \u2014 Commands");
      expect(editCall.embeds[0].data.description).toBeDefined();
    });

    it("formats clear response with success embed", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ deleted: true }),
      });

      const interaction = mockInteraction("clear");
      await handleInteraction(interaction as never);

      const editCall = interaction.editReply.mock.calls[0][0];
      expect(editCall.embeds[0].data.color).toBe(0x22c55e);
      expect(editCall.embeds[0].data.description).toContain("Conversation cleared");
    });

    it("formats error responses as plain content", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      const editCall = interaction.editReply.mock.calls[0][0];
      expect(editCall.content).toBeDefined();
      expect(typeof editCall.content).toBe("string");
    });
  });
});
