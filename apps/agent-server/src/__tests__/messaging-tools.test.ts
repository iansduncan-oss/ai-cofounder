import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

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

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
}));

vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class {},
}));

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  hashCode: vi.fn().mockReturnValue("hash"),
}));

vi.mock("../services/notifications.js", () => ({
  notifyApprovalCreated: vi.fn(),
}));

vi.mock("../agents/tools/github-tools.js", () => ({
  CREATE_PR_TOOL: { name: "create_pr", description: "Create PR", input_schema: { type: "object", properties: {}, required: [] } },
  executeCreatePr: vi.fn().mockResolvedValue({ success: true }),
}));

const { buildSharedToolList, executeSharedTool } = await import("../agents/tool-executor.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Messaging tools in buildSharedToolList ──────────────────────────────

describe("buildSharedToolList — messaging tools", () => {
  it("includes messaging tools when messagingService is provided", () => {
    const tools = buildSharedToolList({ messagingService: {} as any });
    const names = tools.map((t) => t.name);

    expect(names).toContain("send_message");
    expect(names).toContain("check_messages");
    expect(names).toContain("broadcast_update");
  });

  it("excludes messaging tools when messagingService is not provided", () => {
    const tools = buildSharedToolList({});
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("send_message");
    expect(names).not.toContain("check_messages");
    expect(names).not.toContain("broadcast_update");
  });
});

// ─── executeSharedTool — messaging cases ─────────────────────────────────

describe("executeSharedTool — messaging tools", () => {
  const context = {
    conversationId: "conv-1",
    userId: "user-1",
    agentRole: "orchestrator",
    agentRunId: "run-1",
    goalId: "goal-1",
  };

  describe("send_message", () => {
    it("returns error when messagingService is not available", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "send_message",
          input: {
            target_role: "coder",
            message_type: "request",
            subject: "Test",
            body: "Test body",
          },
        },
        {},
        context,
      );

      expect(result).toEqual({ error: "Messaging not available" });
    });

    it("sends a message and returns result with correlationId", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        messageId: "msg-1",
        correlationId: "corr-1",
      });
      const messagingService = { send: mockSend } as any;

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "send_message",
          input: {
            target_role: "researcher",
            message_type: "request",
            subject: "Need info",
            body: "Please research X",
            priority: "high",
          },
        },
        { messagingService },
        context,
      );

      expect(mockSend).toHaveBeenCalledWith({
        senderRole: "orchestrator",
        senderRunId: "run-1",
        targetRole: "researcher",
        messageType: "request",
        subject: "Need info",
        body: "Please research X",
        inReplyTo: undefined,
        correlationId: undefined,
        priority: "high",
        goalId: "goal-1",
        conversationId: "conv-1",
        metadata: { messageDepth: 0 },
      });

      expect(result).toEqual({
        sent: true,
        messageId: "msg-1",
        correlationId: "corr-1",
        message: 'Message sent. Use check_messages with correlation_id="corr-1" to check for a response.',
      });
    });

    it("sends a notification without correlationId", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        messageId: "msg-2",
        correlationId: undefined,
      });
      const messagingService = { send: mockSend } as any;

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "send_message",
          input: {
            target_role: "coder",
            message_type: "notification",
            subject: "FYI",
            body: "Just letting you know",
          },
        },
        { messagingService },
        context,
      );

      expect(result).toEqual({
        sent: true,
        messageId: "msg-2",
        correlationId: undefined,
        message: "Message sent.",
      });
    });

    it("passes in_reply_to and correlation_id", async () => {
      const mockSend = vi.fn().mockResolvedValue({
        messageId: "msg-3",
        correlationId: "corr-existing",
      });
      const messagingService = { send: mockSend } as any;

      await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "send_message",
          input: {
            target_role: "orchestrator",
            message_type: "response",
            subject: "Reply",
            body: "Here is the answer",
            in_reply_to: "msg-original",
            correlation_id: "corr-existing",
          },
        },
        { messagingService },
        { ...context, agentRole: "coder" },
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          senderRole: "coder",
          inReplyTo: "msg-original",
          correlationId: "corr-existing",
        }),
      );
    });
  });

  describe("check_messages — personal inbox", () => {
    it("returns error when messagingService is not available", async () => {
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "check_messages", input: {} },
        {},
        context,
      );

      expect(result).toEqual({ error: "Messaging not available" });
    });

    it("checks personal inbox and returns formatted messages", async () => {
      const mockCheckInbox = vi.fn().mockResolvedValue([
        {
          id: "m-1",
          senderRole: "coder",
          targetRole: "orchestrator",
          messageType: "response",
          subject: "Done",
          body: "Task completed",
          correlationId: "corr-1",
          inReplyTo: "msg-0",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ]);
      const messagingService = { checkInbox: mockCheckInbox } as any;

      const result = (await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "check_messages", input: {} },
        { messagingService },
        context,
      )) as any;

      expect(mockCheckInbox).toHaveBeenCalledWith({
        targetRole: "orchestrator",
        targetRunId: "run-1",
        correlationId: undefined,
        senderRole: undefined,
        messageType: undefined,
        unreadOnly: undefined,
      });

      expect(result.count).toBe(1);
      expect(result.messages[0]).toEqual({
        id: "m-1",
        senderRole: "coder",
        targetRole: "orchestrator",
        messageType: "response",
        subject: "Done",
        body: "Task completed",
        correlationId: "corr-1",
        inReplyTo: "msg-0",
        createdAt: "2024-01-01T00:00:00Z",
      });
    });

    it("passes filters from input", async () => {
      const mockCheckInbox = vi.fn().mockResolvedValue([]);
      const messagingService = { checkInbox: mockCheckInbox } as any;

      await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "check_messages",
          input: {
            correlation_id: "corr-1",
            sender_role: "coder",
            message_type: "response",
            unread_only: false,
          },
        },
        { messagingService },
        context,
      );

      expect(mockCheckInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: "corr-1",
          senderRole: "coder",
          messageType: "response",
          unreadOnly: false,
        }),
      );
    });
  });

  describe("check_messages — broadcast channel", () => {
    it("checks broadcast channel when channel is specified", async () => {
      const mockCheckBroadcast = vi.fn().mockResolvedValue([
        {
          id: "b-1",
          senderRole: "researcher",
          subject: "Finding",
          body: "Found something important",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ]);
      const messagingService = { checkBroadcast: mockCheckBroadcast } as any;

      const result = (await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "check_messages",
          input: { channel: "findings" },
        },
        { messagingService },
        context,
      )) as any;

      expect(mockCheckBroadcast).toHaveBeenCalledWith("findings", {
        goalId: "goal-1",
      });

      expect(result.channel).toBe("findings");
      expect(result.count).toBe(1);
      expect(result.messages[0]).toEqual({
        id: "b-1",
        senderRole: "researcher",
        subject: "Finding",
        body: "Found something important",
        createdAt: "2024-01-01T00:00:00Z",
      });
    });
  });

  describe("broadcast_update", () => {
    it("returns error when messagingService is not available", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "broadcast_update",
          input: { channel: "progress", subject: "Update", body: "50% done" },
        },
        {},
        context,
      );

      expect(result).toEqual({ error: "Messaging not available" });
    });

    it("broadcasts a message and returns result", async () => {
      const mockBroadcast = vi.fn().mockResolvedValue({ messageId: "msg-b1" });
      const messagingService = { broadcast: mockBroadcast } as any;

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "broadcast_update",
          input: { channel: "progress", subject: "Half done", body: "50% complete" },
        },
        { messagingService },
        context,
      );

      expect(mockBroadcast).toHaveBeenCalledWith({
        senderRole: "orchestrator",
        senderRunId: "run-1",
        channel: "progress",
        subject: "Half done",
        body: "50% complete",
        goalId: "goal-1",
        conversationId: "conv-1",
      });

      expect(result).toEqual({
        broadcast: true,
        messageId: "msg-b1",
        channel: "progress",
      });
    });
  });
});
