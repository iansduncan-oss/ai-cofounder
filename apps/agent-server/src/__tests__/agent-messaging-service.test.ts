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

const mockSendAgentMessage = vi.fn().mockResolvedValue({ id: "msg-1" });
const mockGetAgentInbox = vi.fn().mockResolvedValue([]);
const mockGetChannelMessages = vi.fn().mockResolvedValue([]);
const mockGetResponseToRequest = vi.fn().mockResolvedValue(null);
const mockGetMessageThread = vi.fn().mockResolvedValue([]);
const mockMarkMessagesRead = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  sendAgentMessage: (...args: unknown[]) => mockSendAgentMessage(...args),
  getAgentInbox: (...args: unknown[]) => mockGetAgentInbox(...args),
  getChannelMessages: (...args: unknown[]) => mockGetChannelMessages(...args),
  getResponseToRequest: (...args: unknown[]) => mockGetResponseToRequest(...args),
  getMessageThread: (...args: unknown[]) => mockGetMessageThread(...args),
  markMessagesRead: (...args: unknown[]) => mockMarkMessagesRead(...args),
}));

vi.mock("@ai-cofounder/queue", () => ({}));

const { AgentMessagingService } = await import("../services/agent-messaging.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── AgentMessagingService ─────────────────────────────────────────────────

describe("AgentMessagingService", () => {
  const db = {} as any;

  function createService(redisPubSub?: any) {
    return new AgentMessagingService(db, redisPubSub);
  }

  // ─── send ──────────────────────────────────────────────────────────────

  describe("send", () => {
    it("sends a notification message", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "notification",
        subject: "Build complete",
        body: "The build passed.",
      });

      expect(result.messageId).toBe("msg-1");
      expect(mockSendAgentMessage).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          senderRole: "orchestrator",
          targetRole: "coder",
          messageType: "notification",
          subject: "Build complete",
          body: "The build passed.",
        }),
      );
    });

    it("auto-generates correlationId for request type", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "researcher",
        messageType: "request",
        subject: "Need info",
        body: "Please research X.",
      });

      expect(result.correlationId).toBeDefined();
      expect(typeof result.correlationId).toBe("string");
      // Should be a UUID
      expect(result.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("preserves provided correlationId for request type", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "coder",
        targetRole: "orchestrator",
        messageType: "request",
        subject: "Existing correlation",
        body: "Body",
        correlationId: "existing-id",
      });

      expect(result.correlationId).toBe("existing-id");
      expect(mockSendAgentMessage).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ correlationId: "existing-id" }),
      );
    });

    it("sets expiresAt for request messages", async () => {
      const svc = createService();
      await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "request",
        subject: "Test",
        body: "Test body",
      });

      const callArgs = mockSendAgentMessage.mock.calls[0][1];
      expect(callArgs.expiresAt).toBeInstanceOf(Date);
      // Should be ~30 minutes from now
      const diff = callArgs.expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(29 * 60 * 1000);
      expect(diff).toBeLessThan(31 * 60 * 1000);
    });

    it("sets expiresAt for broadcast messages", async () => {
      const svc = createService();
      await svc.send({
        senderRole: "orchestrator",
        channel: "progress",
        messageType: "broadcast",
        subject: "Update",
        body: "Progress update",
      });

      const callArgs = mockSendAgentMessage.mock.calls[0][1];
      expect(callArgs.expiresAt).toBeInstanceOf(Date);
      // Should be ~1 hour from now
      const diff = callArgs.expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(59 * 60 * 1000);
      expect(diff).toBeLessThan(61 * 60 * 1000);
    });

    it("does not set expiresAt for notification messages", async () => {
      const svc = createService();
      await svc.send({
        senderRole: "coder",
        targetRole: "orchestrator",
        messageType: "notification",
        subject: "Done",
        body: "Task done",
      });

      const callArgs = mockSendAgentMessage.mock.calls[0][1];
      expect(callArgs.expiresAt).toBeUndefined();
    });

    it("rejects messages with depth > 2", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "request",
        subject: "Deep message",
        body: "Too deep",
        metadata: { messageDepth: 3 },
      });

      expect(result.messageId).toBe("");
      expect(mockSendAgentMessage).not.toHaveBeenCalled();
    });

    it("allows messages at depth 2", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "notification",
        subject: "Max depth",
        body: "Still ok",
        metadata: { messageDepth: 2 },
      });

      expect(result.messageId).toBe("msg-1");
      expect(mockSendAgentMessage).toHaveBeenCalled();
    });

    it("publishes to Redis when targetRole is set and redisPubSub provided", async () => {
      const mockPublishAgentMessage = vi.fn().mockResolvedValue(undefined);
      const redisPubSub = { publishAgentMessage: mockPublishAgentMessage };
      const svc = createService(redisPubSub);

      await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "notification",
        subject: "Test",
        body: "Test",
      });

      expect(mockPublishAgentMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "msg-1",
          senderRole: "orchestrator",
          targetRole: "coder",
          messageType: "notification",
          subject: "Test",
        }),
      );
    });

    it("publishes to Redis broadcast channel when channel is set", async () => {
      const mockPublishBroadcast = vi.fn().mockResolvedValue(undefined);
      const redisPubSub = { publishBroadcast: mockPublishBroadcast };
      const svc = createService(redisPubSub);

      await svc.send({
        senderRole: "orchestrator",
        channel: "progress",
        messageType: "broadcast",
        subject: "Update",
        body: "Progress",
      });

      expect(mockPublishBroadcast).toHaveBeenCalledWith(
        "progress",
        expect.objectContaining({
          messageId: "msg-1",
          senderRole: "orchestrator",
          channel: "progress",
          messageType: "broadcast",
        }),
      );
    });

    it("does not fail when Redis publish throws", async () => {
      const redisPubSub = {
        publishAgentMessage: vi.fn().mockRejectedValue(new Error("Redis down")),
      };
      const svc = createService(redisPubSub);

      // Should not throw
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "notification",
        subject: "Test",
        body: "Test",
      });

      expect(result.messageId).toBe("msg-1");
    });

    it("skips Redis when no redisPubSub provided", async () => {
      const svc = createService();
      const result = await svc.send({
        senderRole: "orchestrator",
        targetRole: "coder",
        messageType: "notification",
        subject: "Test",
        body: "Test",
      });

      expect(result.messageId).toBe("msg-1");
    });

    it("includes metadata with messageDepth", async () => {
      const svc = createService();
      await svc.send({
        senderRole: "coder",
        targetRole: "orchestrator",
        messageType: "response",
        subject: "Reply",
        body: "Here is the answer",
        metadata: { extra: "data" },
      });

      const callArgs = mockSendAgentMessage.mock.calls[0][1];
      expect(callArgs.metadata).toEqual({ extra: "data", messageDepth: 0 });
    });
  });

  // ─── checkInbox ────────────────────────────────────────────────────────

  describe("checkInbox", () => {
    it("checks inbox by role and marks messages as delivered", async () => {
      const messages = [
        { id: "m-1", senderRole: "coder", subject: "Done" },
        { id: "m-2", senderRole: "researcher", subject: "Found it" },
      ];
      mockGetAgentInbox.mockResolvedValueOnce(messages);

      const svc = createService();
      const result = await svc.checkInbox({ targetRole: "orchestrator" });

      expect(result).toEqual(messages);
      expect(mockGetAgentInbox).toHaveBeenCalledWith(db, {
        targetRole: "orchestrator",
        targetRunId: undefined,
        status: "pending",
        messageType: undefined,
        senderRole: undefined,
        limit: 5,
      });
      expect(mockMarkMessagesRead).toHaveBeenCalledWith(db, ["m-1", "m-2"]);
    });

    it("uses correlationId path when provided", async () => {
      const response = { id: "m-3", senderRole: "coder", subject: "Response" };
      mockGetResponseToRequest.mockResolvedValueOnce(response);

      const svc = createService();
      const result = await svc.checkInbox({
        targetRole: "orchestrator",
        correlationId: "corr-1",
      });

      expect(result).toEqual([response]);
      expect(mockGetResponseToRequest).toHaveBeenCalledWith(db, "corr-1");
      expect(mockMarkMessagesRead).toHaveBeenCalledWith(db, ["m-3"]);
      expect(mockGetAgentInbox).not.toHaveBeenCalled();
    });

    it("returns empty array when correlationId has no response", async () => {
      mockGetResponseToRequest.mockResolvedValueOnce(null);

      const svc = createService();
      const result = await svc.checkInbox({
        targetRole: "orchestrator",
        correlationId: "no-response",
      });

      expect(result).toEqual([]);
      expect(mockMarkMessagesRead).not.toHaveBeenCalled();
    });

    it("does not mark read when inbox is empty", async () => {
      mockGetAgentInbox.mockResolvedValueOnce([]);

      const svc = createService();
      const result = await svc.checkInbox({ targetRole: "coder" });

      expect(result).toEqual([]);
      expect(mockMarkMessagesRead).not.toHaveBeenCalled();
    });

    it("passes unreadOnly=false as status undefined", async () => {
      mockGetAgentInbox.mockResolvedValueOnce([]);

      const svc = createService();
      await svc.checkInbox({ targetRole: "coder", unreadOnly: false });

      expect(mockGetAgentInbox).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ status: undefined }),
      );
    });

    it("passes filters through", async () => {
      mockGetAgentInbox.mockResolvedValueOnce([]);

      const svc = createService();
      await svc.checkInbox({
        targetRole: "orchestrator",
        targetRunId: "run-1",
        senderRole: "coder",
        messageType: "response",
        limit: 10,
      });

      expect(mockGetAgentInbox).toHaveBeenCalledWith(db, {
        targetRole: "orchestrator",
        targetRunId: "run-1",
        status: "pending",
        messageType: "response",
        senderRole: "coder",
        limit: 10,
      });
    });
  });

  // ─── checkBroadcast ────────────────────────────────────────────────────

  describe("checkBroadcast", () => {
    it("gets channel messages with defaults", async () => {
      const msgs = [{ id: "b-1", channel: "progress", subject: "Update" }];
      mockGetChannelMessages.mockResolvedValueOnce(msgs);

      const svc = createService();
      const result = await svc.checkBroadcast("progress");

      expect(result).toEqual(msgs);
      expect(mockGetChannelMessages).toHaveBeenCalledWith(db, {
        channel: "progress",
        goalId: undefined,
        since: undefined,
        limit: 20,
      });
    });

    it("passes options through", async () => {
      mockGetChannelMessages.mockResolvedValueOnce([]);
      const since = new Date("2024-01-01");

      const svc = createService();
      await svc.checkBroadcast("findings", { goalId: "g-1", since, limit: 5 });

      expect(mockGetChannelMessages).toHaveBeenCalledWith(db, {
        channel: "findings",
        goalId: "g-1",
        since,
        limit: 5,
      });
    });
  });

  // ─── getResponse ───────────────────────────────────────────────────────

  describe("getResponse", () => {
    it("delegates to getResponseToRequest", async () => {
      const response = { id: "m-4", body: "Answer" };
      mockGetResponseToRequest.mockResolvedValueOnce(response);

      const svc = createService();
      const result = await svc.getResponse("corr-2");

      expect(result).toEqual(response);
      expect(mockGetResponseToRequest).toHaveBeenCalledWith(db, "corr-2");
    });
  });

  // ─── getThread ─────────────────────────────────────────────────────────

  describe("getThread", () => {
    it("delegates to getMessageThread", async () => {
      const thread = [
        { id: "m-5", messageType: "request" },
        { id: "m-6", messageType: "response" },
      ];
      mockGetMessageThread.mockResolvedValueOnce(thread);

      const svc = createService();
      const result = await svc.getThread("corr-3");

      expect(result).toEqual(thread);
      expect(mockGetMessageThread).toHaveBeenCalledWith(db, "corr-3");
    });
  });

  // ─── broadcast ─────────────────────────────────────────────────────────

  describe("broadcast", () => {
    it("sends a broadcast message via send()", async () => {
      const svc = createService();
      const result = await svc.broadcast({
        senderRole: "orchestrator",
        channel: "progress",
        subject: "50% done",
        body: "Half the tasks are complete.",
      });

      expect(result.messageId).toBe("msg-1");
      expect(mockSendAgentMessage).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          senderRole: "orchestrator",
          channel: "progress",
          messageType: "broadcast",
          subject: "50% done",
          body: "Half the tasks are complete.",
        }),
      );
    });

    it("passes optional fields through", async () => {
      const svc = createService();
      await svc.broadcast({
        senderRole: "coder",
        senderRunId: "run-1",
        channel: "blockers",
        subject: "Blocked",
        body: "Can't proceed",
        goalId: "g-1",
        conversationId: "conv-1",
        metadata: { severity: "high" },
      });

      const callArgs = mockSendAgentMessage.mock.calls[0][1];
      expect(callArgs.senderRunId).toBe("run-1");
      expect(callArgs.goalId).toBe("g-1");
      expect(callArgs.conversationId).toBe("conv-1");
      expect(callArgs.metadata).toEqual(
        expect.objectContaining({ severity: "high" }),
      );
    });
  });
});
