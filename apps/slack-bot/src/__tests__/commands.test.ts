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
  streamChat: vi.fn(),
  listGoals: vi.fn(),
  listPendingTasks: vi.fn(),
  listPendingApprovals: vi.fn(),
  listMemories: vi.fn(),
  executeGoal: vi.fn(),
  streamExecute: vi.fn(),
  resolveApproval: vi.fn(),
  getChannelConversation: vi.fn(),
  setChannelConversation: vi.fn(),
  deleteChannelConversation: vi.fn(),
  getUserByPlatform: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
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
const actionHandlers = new Map<string, (args: Record<string, unknown>) => Promise<void>>();
const eventHandlers = new Map<string, (args: Record<string, unknown>) => Promise<void>>();

vi.mock("@slack/bolt", () => {
  class MockApp {
    command(name: string, handler: (args: Record<string, unknown>) => Promise<void>) {
      commandHandlers.set(name, handler);
    }
    action(actionId: string, handler: (args: Record<string, unknown>) => Promise<void>) {
      actionHandlers.set(actionId, handler);
    }
    event(eventName: string, handler: (args: Record<string, unknown>) => Promise<void>) {
      eventHandlers.set(eventName, handler);
    }
    async start() {}
  }
  return { App: MockApp };
});

import { App } from "@slack/bolt";
import { clearCooldowns } from "@ai-cofounder/bot-handlers";
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
    clearCooldowns();
    commandHandlers.clear();
    actionHandlers.clear();
    eventHandlers.clear();
    app = new App({ token: "t", signingSecret: "s", appToken: "a", socketMode: true });
    registerCommands(app);
  });

  function mockSlackWebClient() {
    return {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: "1234567890.123456" }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  }

  async function invokeCommand(name: string, text = "", overrides: Record<string, unknown> = {}) {
    const handler = commandHandlers.get(name);
    expect(handler).toBeDefined();

    const ack = vi.fn().mockResolvedValue(undefined);
    const respond = vi.fn().mockResolvedValue(undefined);
    const command = mockCommand(text, overrides);
    const client = mockSlackWebClient();

    await handler!({ command, ack, respond, client });
    return { ack, respond, command, client };
  }

  describe("/ask", () => {
    function fakeStream(response: string, model = "claude-sonnet", convId = "conv-1") {
      return (async function* () {
        yield { type: "thinking", data: { round: 1 } };
        yield { type: "text_delta", data: { text: response } };
        yield { type: "done", data: { response, model, conversationId: convId, usage: { inputTokens: 10, outputTokens: 20 } } };
      })();
    }

    it("sends message and responds with streaming update", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-1" });
      mockClient.streamChat.mockReturnValueOnce(fakeStream("Hello from AI"));
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { ack, client } = await invokeCommand("/ask", "Hello");

      expect(ack).toHaveBeenCalled();
      expect(mockClient.streamChat).toHaveBeenCalledWith({
        message: "Hello",
        userId: "U456",
        platform: "slack",
        conversationId: "conv-1",
      });
      // Final update via chat.update with blocks
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "C123",
          text: "Hello from AI",
        }),
      );
    });

    it("handles error gracefully", async () => {
      mockClient.getChannelConversation.mockRejectedValueOnce(new Error("not found"));
      mockClient.streamChat.mockImplementationOnce(() => { throw new Error("Network error"); });

      const { respond } = await invokeCommand("/ask", "Hello");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Something went wrong") }),
      );
    });

    it("works without existing conversation", async () => {
      mockClient.getChannelConversation.mockRejectedValueOnce(new Error("not found"));
      mockClient.streamChat.mockReturnValueOnce(fakeStream("Hi there", "claude-sonnet", "conv-new"));
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { client } = await invokeCommand("/ask", "Hello");

      expect(mockClient.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: undefined }),
      );
      // Should update the message with the response
      expect(client.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Hi there" }),
      );
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
      mockClient.listGoals.mockResolvedValueOnce({
        data: [
          { id: "g1", title: "Build MVP", status: "active", priority: "high" },
          { id: "g2", title: "Deploy", status: "draft", priority: "medium" },
        ],
        total: 2, limit: 50, offset: 0,
      });

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
      mockClient.listGoals.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });

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
      mockClient.listMemories.mockResolvedValueOnce({
        data: [
          { category: "preferences", key: "language", content: "TypeScript" },
          { category: "preferences", key: "framework", content: "Fastify" },
        ],
        total: 2, limit: 50, offset: 0,
      });

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
      mockClient.listMemories.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });

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
      mockClient.streamExecute.mockReturnValueOnce(
        (async function* () {
          yield { type: "progress", data: { taskTitle: "Research", agent: "researcher", status: "completed", goalTitle: "Build MVP", totalTasks: 2, completedTasks: 1 } };
          yield { type: "progress", data: { taskTitle: "Code", agent: "coder", status: "completed", goalTitle: "Build MVP", totalTasks: 2, completedTasks: 2 } };
          yield { type: "completed", data: { goalTitle: "Build MVP", status: "completed", totalTasks: 2, completedTasks: 2 } };
        })(),
      );

      const { respond } = await invokeCommand("/execute", "goal-1");

      expect(mockClient.streamExecute).toHaveBeenCalledWith("goal-1", "U456");
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
      mockClient.streamExecute.mockImplementationOnce(() => {
        throw new Error("Goal not found");
      });

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

  describe("/approvals", () => {
    it("shows pending approvals with buttons", async () => {
      mockClient.listPendingApprovals.mockResolvedValueOnce([
        {
          id: "a1-uuid-full",
          taskId: "t1-uuid-full",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Deploy to production server",
          createdAt: "2026-03-05T10:00:00Z",
        },
      ]);

      const { ack, respond } = await invokeCommand("/approvals");

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "Pending Approvals" }),
          }),
          expect.objectContaining({
            type: "section",
            text: expect.objectContaining({
              text: expect.stringContaining("Deploy to production server"),
            }),
          }),
          expect.objectContaining({
            type: "actions",
            elements: expect.arrayContaining([
              expect.objectContaining({
                action_id: "approval_approve",
                value: "a1-uuid-full",
                style: "primary",
              }),
              expect.objectContaining({
                action_id: "approval_reject",
                value: "a1-uuid-full",
                style: "danger",
              }),
            ]),
          }),
        ]),
      });
    });

    it("shows info message when no pending approvals", async () => {
      mockClient.listPendingApprovals.mockResolvedValueOnce([]);

      const { respond } = await invokeCommand("/approvals");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: "No pending approvals." }),
      );
    });

    it("handles API error", async () => {
      mockClient.listPendingApprovals.mockRejectedValueOnce(new Error("Server error"));

      const { respond } = await invokeCommand("/approvals");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to fetch") }),
      );
    });
  });

  describe("interactive button actions", () => {
    async function invokeAction(actionId: string, approvalId: string) {
      const handler = actionHandlers.get(actionId);
      expect(handler).toBeDefined();

      const ack = vi.fn().mockResolvedValue(undefined);
      const respond = vi.fn().mockResolvedValue(undefined);
      const action = { value: approvalId };
      const body = {
        channel: { id: "C123" },
        user: { id: "U456", name: "testuser" },
      };

      await handler!({ action, ack, respond, body });
      return { ack, respond };
    }

    it("approves via button click", async () => {
      mockClient.resolveApproval.mockResolvedValueOnce({ id: "a1", status: "approved" });

      const { ack, respond } = await invokeAction("approval_approve", "a1");

      expect(ack).toHaveBeenCalled();
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

    it("rejects via button click", async () => {
      mockClient.resolveApproval.mockResolvedValueOnce({ id: "a1", status: "rejected" });

      const { ack, respond } = await invokeAction("approval_reject", "a1");

      expect(ack).toHaveBeenCalled();
      expect(mockClient.resolveApproval).toHaveBeenCalledWith("a1", {
        status: "rejected",
        decision: "Rejected by testuser via slack",
      });
      expect(respond).toHaveBeenCalledWith({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "section",
            text: expect.objectContaining({ text: expect.stringContaining("rejected") }),
          }),
        ]),
      });
    });

    it("handles approve button error", async () => {
      mockClient.resolveApproval.mockRejectedValueOnce(new Error("Already resolved"));

      const { respond } = await invokeAction("approval_approve", "a1");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to approve") }),
      );
    });

    it("handles reject button error", async () => {
      mockClient.resolveApproval.mockRejectedValueOnce(new Error("Already resolved"));

      const { respond } = await invokeAction("approval_reject", "a1");

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Failed to reject") }),
      );
    });
  });

  describe("event: app_mention", () => {
    function fakeEventStream(response: string) {
      return (async function* () {
        yield { type: "thinking", data: { round: 1 } };
        yield { type: "text_delta", data: { text: response } };
        yield { type: "done", data: { response, model: "claude-sonnet", conversationId: "conv-1" } };
      })();
    }

    async function invokeEvent(eventName: string, event: Record<string, unknown>) {
      const handler = eventHandlers.get(eventName);
      expect(handler).toBeDefined();

      const say = vi.fn().mockResolvedValue(undefined);
      const client = {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: "123.456" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      await handler!({ event, say, client });
      return { say, client };
    }

    it("strips bot mention and calls streamChat with cleaned text", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-1" });
      mockClient.streamChat.mockReturnValueOnce(fakeEventStream("Mention reply"));
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { client: slackClient } = await invokeEvent("app_mention", {
        text: "<@U0BOT123> what is the status?",
        channel: "C999",
        user: "U456",
      });

      expect(mockClient.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ message: "what is the status?" }),
      );
      expect(slackClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Mention reply" }),
      );
    });

    it("ignores empty text after stripping mention", async () => {
      const { client: sc } = await invokeEvent("app_mention", {
        text: "<@U0BOT123>",
        channel: "C999",
        user: "U456",
      });

      expect(mockClient.streamChat).not.toHaveBeenCalled();
      expect(sc.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe("event: message (DM)", () => {
    function fakeDmStream(response: string) {
      return (async function* () {
        yield { type: "thinking", data: { round: 1 } };
        yield { type: "text_delta", data: { text: response } };
        yield { type: "done", data: { response, model: "claude-sonnet", conversationId: "conv-dm" } };
      })();
    }

    async function invokeEvent(eventName: string, event: Record<string, unknown>) {
      const handler = eventHandlers.get(eventName);
      expect(handler).toBeDefined();

      const say = vi.fn().mockResolvedValue(undefined);
      const client = {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: "123.456" }),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      await handler!({ event, say, client });
      return { say, client };
    }

    it("responds to DM messages", async () => {
      mockClient.getChannelConversation.mockResolvedValueOnce({ conversationId: "conv-dm" });
      mockClient.streamChat.mockReturnValueOnce(fakeDmStream("DM reply"));
      mockClient.setChannelConversation.mockResolvedValueOnce({});

      const { client } = await invokeEvent("message", {
        text: "hello from DM",
        channel: "D123",
        channel_type: "im",
        user: "U456",
      });

      expect(mockClient.streamChat).toHaveBeenCalledWith(
        expect.objectContaining({ message: "hello from DM" }),
      );
      expect(client.chat.update).toHaveBeenCalled();
    });

    it("ignores non-DM messages", async () => {
      const { client } = await invokeEvent("message", {
        text: "channel message",
        channel: "C123",
        channel_type: "channel",
        user: "U456",
      });

      expect(mockClient.streamChat).not.toHaveBeenCalled();
      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    it("ignores messages with subtypes", async () => {
      const { client } = await invokeEvent("message", {
        text: "edited",
        channel: "D123",
        channel_type: "im",
        user: "U456",
        subtype: "message_changed",
      });

      expect(mockClient.streamChat).not.toHaveBeenCalled();
      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });

    it("ignores messages with no text", async () => {
      const { client: c2 } = await invokeEvent("message", {
        channel: "D123",
        channel_type: "im",
        user: "U456",
      });

      expect(mockClient.streamChat).not.toHaveBeenCalled();
      expect(c2.chat.postMessage).not.toHaveBeenCalled();
    });
  });
});
