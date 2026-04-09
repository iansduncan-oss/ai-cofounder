import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiClient } from "@ai-cofounder/api-client";
import type { CommandContext } from "../types.js";
import { handleAskStreaming } from "../handlers.js";

function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    health: vi.fn(),
    providerHealth: vi.fn(),
    runAgent: vi.fn(),
    createGoal: vi.fn(),
    getGoal: vi.fn(),
    listGoals: vi.fn(),
    updateGoalStatus: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listPendingTasks: vi.fn(),
    assignTask: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    executeGoal: vi.fn(),
    getProgress: vi.fn(),
    createApproval: vi.fn(),
    getApproval: vi.fn(),
    listPendingApprovals: vi.fn(),
    resolveApproval: vi.fn(),
    listMemories: vi.fn(),
    deleteMemory: vi.fn(),
    getChannelConversation: vi.fn(),
    setChannelConversation: vi.fn(),
    deleteChannelConversation: vi.fn(),
    getUserByPlatform: vi.fn(),
    getUsage: vi.fn(),
    streamChat: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

const ctx: CommandContext = {
  channelId: "test-channel",
  userId: "user-1",
  userName: "TestUser",
  platform: "discord",
};

describe("handleAskStreaming", () => {
  it("buffers text_delta events and calls onChunk", async () => {
    async function* fakeStream() {
      yield { type: "thinking" as const, data: { round: 1 } };
      yield { type: "text_delta" as const, data: { text: "Hello " } };
      yield { type: "text_delta" as const, data: { text: "world" } };
      yield { type: "done" as const, data: { response: "Hello world", model: "claude", conversationId: "c-1" } };
    }

    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      streamChat: vi.fn().mockReturnValue(fakeStream()),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    const chunks: string[] = [];
    const result = await handleAskStreaming(client, ctx, "hi", (text) => {
      chunks.push(text);
    });

    expect(result.type).toBe("ask_streaming");
    if (result.type === "ask_streaming") {
      expect(result.data.response).toBe("Hello world");
      expect(result.data.conversationId).toBe("c-1");
    }
    // onChunk should have been called with accumulated text
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns error on stream error event", async () => {
    async function* fakeStream() {
      yield { type: "thinking" as const, data: { round: 1 } };
      yield { type: "error" as const, data: { error: "Something broke" } };
    }

    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("no conv")),
      streamChat: vi.fn().mockReturnValue(fakeStream()),
    });

    const result = await handleAskStreaming(client, ctx, "hi", vi.fn());

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toBe("Something broke");
    }
  });

  it("returns error when streamChat throws", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("no conv")),
      streamChat: vi.fn().mockImplementation(() => {
        throw new Error("Connection refused");
      }),
    });

    const result = await handleAskStreaming(client, ctx, "hi", vi.fn());

    expect(result.type).toBe("error");
  });

  it("progressive text accumulation works correctly", async () => {
    async function* fakeStream() {
      yield { type: "text_delta" as const, data: { text: "A" } };
      yield { type: "text_delta" as const, data: { text: "B" } };
      yield { type: "text_delta" as const, data: { text: "C" } };
      yield { type: "done" as const, data: { response: "ABC", model: "test" } };
    }

    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("no conv")),
      streamChat: vi.fn().mockReturnValue(fakeStream()),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    const chunks: string[] = [];
    await handleAskStreaming(client, ctx, "hi", (text) => {
      chunks.push(text);
    });

    // Chunks should show progressive accumulation
    expect(chunks[0]).toBe("A");
    expect(chunks[1]).toBe("AB");
    expect(chunks[2]).toBe("ABC");
  });

  it("starts a fresh conversation when existing one is stale (>30 min)", async () => {
    async function* fakeStream() {
      yield { type: "text_delta" as const, data: { text: "Fresh" } };
      yield { type: "done" as const, data: { response: "Fresh", model: "claude", conversationId: "new-conv" } };
    }

    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "old-conv", updatedAt: staleTime }),
      streamChat: vi.fn().mockReturnValue(fakeStream()),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    await handleAskStreaming(client, ctx, "hi", vi.fn());

    // streamChat should have been called WITHOUT the old conversationId
    expect(client.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    );
  });

  it("reuses conversation when not stale (<30 min)", async () => {
    async function* fakeStream() {
      yield { type: "text_delta" as const, data: { text: "Continued" } };
      yield { type: "done" as const, data: { response: "Continued", model: "claude", conversationId: "c-1" } };
    }

    const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "existing-conv", updatedAt: recentTime }),
      streamChat: vi.fn().mockReturnValue(fakeStream()),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    await handleAskStreaming(client, ctx, "hi", vi.fn());

    // streamChat should have been called WITH the existing conversationId
    expect(client.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "existing-conv" }),
    );
  });
});
