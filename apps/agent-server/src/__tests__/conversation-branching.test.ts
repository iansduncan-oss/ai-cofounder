import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock DB functions
const mockGetConversation = vi.fn();
const mockCreateConversation = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockCreateMessage = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock("@ai-cofounder/db", () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  createConversation: (...args: unknown[]) => mockCreateConversation(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  createMessage: (...args: unknown[]) => mockCreateMessage(...args),
  conversations: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ col: _col, val: _val })),
}));

const { ConversationBranchingService } = await import("../services/conversation-branching.js");

describe("ConversationBranchingService", () => {
  let service: InstanceType<typeof ConversationBranchingService>;
  const mockDb = { update: mockUpdate } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ConversationBranchingService(mockDb);
  });

  it("branch() creates a new conversation from an existing one", async () => {
    mockGetConversation.mockResolvedValueOnce({
      id: "conv-1",
      workspaceId: "ws-1",
    });
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-2" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", agentRole: null, content: "Hello" },
      { id: "msg-2", role: "agent", agentRole: "orchestrator", content: "Hi there" },
    ]);
    mockCreateMessage.mockResolvedValue({ id: "new-msg" });

    const result = await service.branch("conv-1", "user-1");

    expect(result.id).toBe("conv-2");
    expect(result.messagesCopied).toBe(2);
    expect(mockCreateConversation).toHaveBeenCalledWith(mockDb, {
      userId: "user-1",
      title: undefined,
      workspaceId: "ws-1",
    });
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
  });

  it("copies messages up to branch point", async () => {
    mockGetConversation.mockResolvedValueOnce({ id: "conv-1", workspaceId: "ws-1" });
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-3" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", agentRole: null, content: "Hello" },
      { id: "msg-2", role: "agent", agentRole: "orchestrator", content: "Hi" },
      { id: "msg-3", role: "user", agentRole: null, content: "Follow up" },
      { id: "msg-4", role: "agent", agentRole: "orchestrator", content: "Reply" },
    ]);
    mockCreateMessage.mockResolvedValue({ id: "new-msg" });

    const result = await service.branch("conv-1", "user-1", "msg-2");

    expect(result.messagesCopied).toBe(2);
    expect(mockCreateMessage).toHaveBeenCalledTimes(2);
    // Verify only first two messages were copied
    expect(mockCreateMessage).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      conversationId: "conv-3",
      content: "Hello",
    }));
    expect(mockCreateMessage).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      conversationId: "conv-3",
      content: "Hi",
    }));
  });

  it("copies all messages when no branch point specified", async () => {
    mockGetConversation.mockResolvedValueOnce({ id: "conv-1", workspaceId: "ws-1" });
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-4" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", agentRole: null, content: "A" },
      { id: "msg-2", role: "agent", agentRole: null, content: "B" },
      { id: "msg-3", role: "user", agentRole: null, content: "C" },
    ]);
    mockCreateMessage.mockResolvedValue({ id: "new-msg" });

    const result = await service.branch("conv-1", "user-1");

    expect(result.messagesCopied).toBe(3);
    expect(mockCreateMessage).toHaveBeenCalledTimes(3);
  });

  it("handles non-existent conversation gracefully", async () => {
    mockGetConversation.mockResolvedValueOnce(null);
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-5" });
    mockGetConversationMessages.mockResolvedValueOnce([]);
    mockCreateMessage.mockResolvedValue({ id: "new-msg" });

    const result = await service.branch("nonexistent", "user-1");

    expect(result.id).toBe("conv-5");
    expect(result.messagesCopied).toBe(0);
    // workspaceId falls back to "" when original is null
    expect(mockCreateConversation).toHaveBeenCalledWith(mockDb, {
      userId: "user-1",
      title: undefined,
      workspaceId: "",
    });
  });

  it("preserves workspaceId from original conversation", async () => {
    mockGetConversation.mockResolvedValueOnce({
      id: "conv-1",
      workspaceId: "workspace-abc",
    });
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-6" });
    mockGetConversationMessages.mockResolvedValueOnce([]);

    await service.branch("conv-1", "user-1");

    expect(mockCreateConversation).toHaveBeenCalledWith(mockDb, {
      userId: "user-1",
      title: undefined,
      workspaceId: "workspace-abc",
    });
  });

  it("copies all messages when branch point message not found in history", async () => {
    mockGetConversation.mockResolvedValueOnce({ id: "conv-1", workspaceId: "ws-1" });
    mockCreateConversation.mockResolvedValueOnce({ id: "conv-7" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", agentRole: null, content: "A" },
      { id: "msg-2", role: "agent", agentRole: null, content: "B" },
    ]);
    mockCreateMessage.mockResolvedValue({ id: "new-msg" });

    const result = await service.branch("conv-1", "user-1", "msg-nonexistent");

    // When branch point not found, all messages are copied
    expect(result.messagesCopied).toBe(2);
  });
});
