import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  requireEnv: (name: string) => `test-${name}`,
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock @ai-cofounder/api-client
const mockClient = {
  health: vi.fn(),
  runAgent: vi.fn(),
  listGoals: vi.fn(),
  listPendingTasks: vi.fn(),
  listMemories: vi.fn(),
  executeGoal: vi.fn(),
  resolveApproval: vi.fn(),
  getChannelConversation: vi.fn(),
  setChannelConversation: vi.fn(),
  deleteChannelConversation: vi.fn(),
  getUserByPlatform: vi.fn(),
};

vi.mock("@ai-cofounder/api-client", () => {
  class MockApiClient {
    constructor() {
      return mockClient;
    }
  }
  class MockApiError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.name = "ApiError";
    }
  }
  return { ApiClient: MockApiClient, ApiError: MockApiError };
});

// Mock @slack/bolt
const commandHandlers = new Map<string, (args: Record<string, unknown>) => Promise<void>>();

vi.mock("@slack/bolt", () => {
  class MockApp {
    command(name: string, handler: (args: Record<string, unknown>) => Promise<void>) {
      commandHandlers.set(name, handler);
    }
    async start() {}
  }
  return { App: MockApp };
});

import { App } from "@slack/bolt";
import { registerCommands } from "../commands.js";

function mockCommand(text = "", overrides: Record<string, unknown> = {}) {
  return {
    channel_id: "C123",
    user_id: "U456",
    user_name: "testuser",
    text,
    ...overrides,
  };
}

describe("slack commands", () => {
  let app: InstanceType<typeof App>;

  beforeEach(() => {
    vi.clearAllMocks();
    commandHandlers.clear();
    app = new App({ token: "t", signingSecret: "s", appToken: "a", socketMode: true });
    registerCommands(app);
  });

  async function invokeCommand(name: string, text = "", overrides: Record<string, unknown> = {}) {
    const handler = commandHandlers.get(name);
    expect(handler).toBeDefined();

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    const command = mockCommand(text, overrides);

    await handler!({ command, ack, respond });
    return { ack, respond, command };
  }

  describe("/ask", () => {
    it("sends message and responds with blocks", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-1" });
      mockClient.runAgent.mockResolvedValueOnce({
        conversationId: "conv-1",
        agentRole: "orchestrator",
        response: "Hello from AI",
        model: "claude-sonnet",
        usage: { inputTokens: 10, outputTokens: 20 },
      });
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { ack, respond } = await invokeCommand("/ask", "Hello");

      expect(ack).toHaveBeenCalled();
      expect(mockClient.runAgent).toHaveBeenCalledWith({
        message: "Hello",
        userId: "U456",
        platform: "slack",
        conversationId: "conv-1",
      });
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "section",
            text: expect.objectContaining({ text: "Hello from AI" }),
          }),
        ]),
      });
    });

    it("handles error gracefully", async () => {
      mockClient.getChannelConversation.mockRejectedValueOnce(new Error("not found"));
      mockClient.runAgent.mockRejectedValueOnce(new Error("Network error"));

      const { respond } = await invokeCommand("/ask", "Hello");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Something went wrong") }),
      );
    });

    it("works without existing conversation", async () => {
      mockClient.getChannelConversation.mockRejectedValueOnce(new Error("not found"));
      mockClient.runAgent.mockResolvedValueOnce({
        conversationId: "conv-new",
        agentRole: "orchestrator",
        response: "Hi there",
        model: "claude-sonnet",
      });
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { respond } = await invokeCommand("/ask", "Hello");

      expect(mockClient.runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: undefined }),
      );
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: "section" }),
        ]),
      });
    });
  });

  describe("/status", () => {
    it("displays health status", async () => {
      mockClient.health.mockResolvedValueOnce({
        status: "ok",
        timestamp: "2026-01-01T00:00:00Z",
        uptime: 3600,
      });

      const { ack, respond } = await invokeCommand("/status");

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "AI Cofounder — System Status" }),
          }),
        ]),
      });
    });

    it("handles connection failure", async () => {
      mockClient.health.mockRejectedValueOnce(new Error("Connection refused"));

      const { respond } = await invokeCommand("/status");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("unreachable") }),
      );
    });
  });

  describe("/goals", () => {
    it("shows no conversation message when channel has none", async () => {
      mockClient.getChannelConversation.mockRejectedValueOnce(new Error("not found"));

      const { respond } = await invokeCommand("/goals");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("No conversation") }),
      );
    });

    it("shows goals list", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-1" });
      mockClient.listGoals.mockResolvedValueOnce([
        { id: "g1", title: "Build MVP", status: "active", priority: "high" },
        { id: "g2", title: "Deploy", status: "draft", priority: "medium" },
      ]);

      const { respond } = await invokeCommand("/goals");

      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "Goals" }),
          }),
        ]),
      });
    });

    it("shows empty message when no goals", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-1" });
      mockClient.listGoals.mockResolvedValueOnce([]);

      const { respond } = await invokeCommand("/goals");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("No goals") }),
      );
    });
  });

  describe("/tasks", () => {
    it("shows pending tasks", async () => {
      mockClient.listPendingTasks.mockResolvedValueOnce([
        { id: "t1", title: "Research competitors", status: "pending", assignedAgent: "researcher" },
      ]);

      const { respond } = await invokeCommand("/tasks");

      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "Pending Tasks" }),
          }),
        ]),
      });
    });

    it("shows empty message when no tasks", async () => {
      mockClient.listPendingTasks.mockResolvedValueOnce([]);

      const { respond } = await invokeCommand("/tasks");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: "No pending tasks." }),
      );
    });
  });

  describe("/memory", () => {
    it("shows no memories when user not found", async () => {
      mockClient.getUserByPlatform.mockRejectedValueOnce(new Error("not found"));

      const { respond } = await invokeCommand("/memory");

      expect(respond).toHaveBeenCalledWith({
        response_type: "ephemeral",
        text: expect.stringContaining("don't have any memories"),
      });
    });

    it("shows memories grouped by category", async () => {
      mockClient.getUserByPlatform.mockResolvedValueOnce({ id: "u1", displayName: "Test" });
      mockClient.listMemories.mockResolvedValueOnce([
        { category: "preferences", key: "language", content: "TypeScript" },
        { category: "preferences", key: "framework", content: "Fastify" },
      ]);

      const { respond } = await invokeCommand("/memory");

      expect(respond).toHaveBeenCalledWith({
        response_type: "ephemeral",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: expect.stringContaining("Memories") }),
          }),
        ]),
      });
    });

    it("shows empty memories message when user exists but has none", async () => {
      mockClient.getUserByPlatform.mockResolvedValueOnce({ id: "u1" });
      mockClient.listMemories.mockResolvedValueOnce([]);

      const { respond } = await invokeCommand("/memory");

      expect(respond).toHaveBeenCalledWith({
        response_type: "ephemeral",
        text: expect.stringContaining("haven't saved any memories"),
      });
    });
  });

  describe("/clear", () => {
    it("clears conversation and responds with success", async () => {
      mockClient.deleteChannelConversation.mockResolvedValueOnce({ deleted: true });

      const { respond } = await invokeCommand("/clear");

      expect(mockClient.deleteChannelConversation).toHaveBeenCalledWith("slack-C123");
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "section",
            text: expect.objectContaining({ text: expect.stringContaining("Conversation cleared") }),
          }),
        ]),
      });
    });

    it("handles clear failure", async () => {
      mockClient.deleteChannelConversation.mockRejectedValueOnce(new Error("fail"));

      const { respond } = await invokeCommand("/clear");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to clear") }),
      );
    });
  });

  describe("/execute", () => {
    it("executes a goal and shows results", async () => {
      mockClient.executeGoal.mockResolvedValueOnce({
        goalTitle: "Build MVP",
        status: "completed",
        totalTasks: 2,
        completedTasks: 2,
        tasks: [
          { title: "Research", agent: "researcher", status: "completed" },
          { title: "Code", agent: "coder", status: "completed" },
        ],
      });

      const { respond } = await invokeCommand("/execute", "goal-1");

      expect(mockClient.executeGoal).toHaveBeenCalledWith("goal-1", { userId: "U456" });
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "Executing: Build MVP" }),
          }),
        ]),
      });
    });

    it("shows error on execution failure", async () => {
      mockClient.executeGoal.mockRejectedValueOnce(new Error("Goal not found"));

      const { respond } = await invokeCommand("/execute", "bad-id");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to execute goal") }),
      );
    });

    it("shows usage message when no goal_id provided", async () => {
      const { respond } = await invokeCommand("/execute", "");

      expect(respond).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    });
  });

  describe("/approve", () => {
    it("approves and shows success", async () => {
      mockClient.resolveApproval.mockResolvedValueOnce({ id: "a1", status: "approved" });

      const { respond } = await invokeCommand("/approve", "a1");

      expect(mockClient.resolveApproval).toHaveBeenCalledWith("a1", {
        status: "approved",
        decision: "Approved by testuser via slack",
      });
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "section",
            text: expect.objectContaining({ text: expect.stringContaining("approved") }),
          }),
        ]),
      });
    });

    it("shows error on approval failure", async () => {
      mockClient.resolveApproval.mockRejectedValueOnce(new Error("Already resolved"));

      const { respond } = await invokeCommand("/approve", "a1");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to approve") }),
      );
    });

    it("shows usage message when no approval_id provided", async () => {
      const { respond } = await invokeCommand("/approve", "");

      expect(respond).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    });
  });
});
