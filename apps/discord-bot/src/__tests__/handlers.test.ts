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
  return {
    isChatInputCommand: () => true,
    commandName,
    channelId: "test-channel-123",
    user: { id: "user-123", username: "testuser" },
    options: {
      getString: (name: string, _required?: boolean) => options[name] ?? null,
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

const { handleInteraction } = await import("../handlers/interaction.js");

describe("interaction handler", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("handleAsk", () => {
    function createSSEBody(events: Array<{ event: string; data: Record<string, unknown> }>) {
      const text = events
        .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
        .join("");
      const encoder = new TextEncoder();
      const chunks = [encoder.encode(text)];
      let index = 0;
      return {
        getReader() {
          return {
            read() {
              if (index < chunks.length) return Promise.resolve({ done: false, value: chunks[index++] });
              return Promise.resolve({ done: true, value: undefined });
            },
            releaseLock: vi.fn(),
          };
        },
      };
    }

    it("sends message to agent server and replies with embed", async () => {
      const channelFetch = vi
        .fn()
        // getChannelConversationId
        .mockResolvedValueOnce({ ok: true, json: () => ({ conversationId: "conv-1" }) })
        // POST /api/agents/run/stream (streaming endpoint)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: createSSEBody([
            { event: "thinking", data: { round: 1, message: "Loading..." } },
            { event: "text_delta", data: { text: "Hello from AI" } },
            { event: "done", data: { response: "Hello from AI", model: "claude-sonnet", conversationId: "conv-1", usage: { inputTokens: 10, outputTokens: 20 } } },
          ]),
        })
        // saveChannelConversationId
        .mockResolvedValueOnce({ ok: true, json: () => ({ conversationId: "conv-1" }) });

      global.fetch = channelFetch;

      const interaction = mockInteraction("ask", { message: "Hello" });
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "",
        embeds: [expect.objectContaining({ data: expect.objectContaining({ color: 0x7c3aed }) })],
      });
    });

    it("replies with error message when fetch fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Not found" }),
        }) // getChannelConversationId
        .mockRejectedValueOnce(new Error("Network error")); // POST /api/agents/run

      const interaction = mockInteraction("ask", { message: "Hello" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Something went wrong"),
      });
    });

    it("replies with error when server returns non-ok", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "Not found" }),
        }) // getChannelConversationId
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Internal error" }),
        });

      const interaction = mockInteraction("ask", { message: "Hello" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Something went wrong"),
      });
    });
  });

  describe("handleStatus", () => {
    it("displays health status embed", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({ status: "ok", timestamp: "2026-01-01T00:00:00Z", uptime: 3600 }),
      });

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x22c55e,
              title: "AI Cofounder — System Status",
            }),
          }),
        ],
      });
    });

    it("replies with error when health check fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      const interaction = mockInteraction("status");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("unreachable"),
      });
    });
  });

  describe("handleGoals", () => {
    it("shows no conversation message when channel has no conversation", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Not found" }),
      });

      const interaction = mockInteraction("goals");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No conversation"),
      });
    });

    it("shows goals list", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => ({ conversationId: "conv-1" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => [
            { id: "g1", title: "Build MVP", status: "active", priority: "high" },
            { id: "g2", title: "Deploy", status: "draft", priority: "medium" },
          ],
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

    it("shows empty message when no goals exist", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => ({ conversationId: "conv-1" }) })
        .mockResolvedValueOnce({ ok: true, json: () => [] });

      const interaction = mockInteraction("goals");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("No goals"),
      });
    });
  });

  describe("handleTasks", () => {
    it("shows pending tasks", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [
          {
            id: "t1",
            title: "Research competitors",
            status: "pending",
            assignedAgent: "researcher",
          },
        ],
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

    it("shows empty message when no tasks", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => [],
      });

      const interaction = mockInteraction("tasks");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "No pending tasks.",
      });
    });
  });

  describe("handleMemory", () => {
    it("shows no memories message when user not found", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Not found" }),
      });

      const interaction = mockInteraction("memory");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("don't have any memories"),
      });
    });

    it("shows memories grouped by category", async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ ok: true, json: () => ({ id: "u1", displayName: "Test" }) })
        .mockResolvedValueOnce({
          ok: true,
          json: () => [
            { category: "preferences", key: "language", content: "TypeScript" },
            { category: "preferences", key: "framework", content: "Fastify" },
          ],
        });

      const interaction = mockInteraction("memory");
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining("Memories"),
            }),
          }),
        ],
      });
    });
  });

  describe("handleClear", () => {
    it("clears conversation and replies with success embed", async () => {
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
  });

  describe("handleExecute", () => {
    it("executes a goal and shows results", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => ({
          goalTitle: "Build MVP",
          status: "completed",
          totalTasks: 2,
          completedTasks: 2,
          tasks: [
            { title: "Research", agent: "researcher", status: "completed" },
            { title: "Code", agent: "coder", status: "completed" },
          ],
        }),
      });

      const interaction = mockInteraction("execute", { goal_id: "goal-1" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              color: 0x22c55e,
              title: "Executing: Build MVP",
            }),
          }),
        ],
      });
    });

    it("shows error on execution failure", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Goal not found" }),
      });

      const interaction = mockInteraction("execute", { goal_id: "bad-id" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to execute goal"),
      });
    });
  });

  describe("handleApprove", () => {
    it("approves and shows success embed", async () => {
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

    it("shows error on approval failure", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Already resolved" }),
      });

      const interaction = mockInteraction("approve", { approval_id: "a1" });
      await handleInteraction(interaction as never);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("Failed to approve"),
      });
    });
  });

  describe("unknown command", () => {
    it("does nothing for unknown commands", async () => {
      const interaction = mockInteraction("nonexistent");
      await handleInteraction(interaction as never);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe("non-command interactions", () => {
    it("ignores non-chat-input interactions", async () => {
      const interaction = {
        isChatInputCommand: () => false,
      };
      await handleInteraction(interaction as never);
      // Should return without error
    });
  });
});
