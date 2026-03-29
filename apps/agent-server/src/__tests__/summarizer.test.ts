import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockComplete = vi.fn();

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry };
});

const mockGetConversationMessageCount = vi.fn();
const mockGetLatestConversationSummary = vi.fn();
const mockSaveConversationSummary = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockRecallMemories = vi.fn();
const mockSearchMemoriesByVector = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getConversationMessageCount: (...args: unknown[]) => mockGetConversationMessageCount(...args),
  getLatestConversationSummary: (...args: unknown[]) => mockGetLatestConversationSummary(...args),
  saveConversationSummary: (...args: unknown[]) => mockSaveConversationSummary(...args),
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  searchMemoriesByVector: (...args: unknown[]) => mockSearchMemoriesByVector(...args),
}));

vi.mock("../services/notifications.js", () => ({
  notifyApprovalCreated: vi.fn().mockResolvedValue(undefined),
}));

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    provider: "test",
    stop_reason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("summarizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizeMessages calls registry with formatted messages", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Summary of the conversation."));
    const { summarizeMessages } = await import("../agents/summarizer.js");
    const { LlmRegistry } = await import("@ai-cofounder/llm");
    const registry = new LlmRegistry();

    const messages = [
      { role: "user" as const, content: "Hello, can you help?" },
      { role: "agent" as const, content: "Sure, what do you need?" },
      { role: "user" as const, content: "I need a database migration." },
    ];

    const result = await summarizeMessages(registry, messages);
    expect(result).toBe("Summary of the conversation.");
    expect(mockComplete).toHaveBeenCalledWith("simple", expect.objectContaining({
      messages: [expect.objectContaining({
        role: "user",
        content: expect.stringContaining("[user]: Hello"),
      })],
    }));
  });

  it("summarizeMessages includes all messages in the prompt", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Summary here."));
    const { summarizeMessages } = await import("../agents/summarizer.js");
    const { LlmRegistry } = await import("@ai-cofounder/llm");
    const registry = new LlmRegistry();

    const messages = [
      { role: "user" as const, content: "First message" },
      { role: "agent" as const, content: "Second message" },
    ];

    await summarizeMessages(registry, messages);
    const call = mockComplete.mock.calls[0];
    const userContent = call[1].messages[0].content as string;
    expect(userContent).toContain("[user]: First message");
    expect(userContent).toContain("[agent]: Second message");
  });
});

describe("orchestrator auto semantic retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecallMemories.mockResolvedValue([]);
    mockSearchMemoriesByVector.mockResolvedValue([]);
  });

  it("merges relevant and general memories when embedding service is available", async () => {
    const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    mockRecallMemories.mockResolvedValue([
      { id: "mem-1", category: "projects", key: "project-a", content: "Info about project A", updatedAt: new Date() },
      { id: "mem-2", category: "technical", key: "stack", content: "Using Node.js", updatedAt: new Date() },
    ]);
    mockSearchMemoriesByVector.mockResolvedValue([
      { id: "mem-2", category: "technical", key: "stack", content: "Using Node.js", updated_at: new Date() },
      { id: "mem-3", category: "decisions", key: "db-choice", content: "PostgreSQL chosen", updated_at: new Date() },
    ]);

    mockComplete.mockResolvedValue(textResponse("Response text"));

    const { Orchestrator } = await import("../agents/orchestrator.js");
    const { LlmRegistry } = await import("@ai-cofounder/llm");
    const registry = new LlmRegistry();

    const orchestrator = new Orchestrator({
      registry,
      db: { execute: vi.fn().mockResolvedValue([]) } as any,
      embeddingService: { embed: mockEmbed } as any,
    });

    await orchestrator.run("Tell me about my projects", undefined, [], "user-1");

    expect(mockEmbed).toHaveBeenCalledWith("Tell me about my projects");
    expect(mockSearchMemoriesByVector).toHaveBeenCalled();

    // Verify the system prompt was built with merged memories
    const call = mockComplete.mock.calls[0];
    const systemPrompt = call[1].system;
    expect(systemPrompt).toContain("Relevant to this conversation");
    expect(systemPrompt).toContain("General knowledge");
    expect(systemPrompt).toContain("db-choice");
    expect(systemPrompt).toContain("project-a");
  });

  it("falls back to importance-only when embedding service fails", async () => {
    const mockEmbed = vi.fn().mockRejectedValue(new Error("Embedding failed"));
    mockRecallMemories.mockResolvedValue([
      { id: "mem-1", category: "projects", key: "project-a", content: "Info", updatedAt: new Date() },
    ]);

    mockComplete.mockResolvedValue(textResponse("Response text"));

    const { Orchestrator } = await import("../agents/orchestrator.js");
    const { LlmRegistry } = await import("@ai-cofounder/llm");
    const registry = new LlmRegistry();

    const orchestrator = new Orchestrator({
      registry,
      db: { execute: vi.fn().mockResolvedValue([]) } as any,
      embeddingService: { embed: mockEmbed } as any,
    });

    const result = await orchestrator.run("Hello", undefined, [], "user-1");
    expect(result.response).toBe("Response text");

    // Should still work with importance-only memories
    const call = mockComplete.mock.calls[0];
    const systemPrompt = call[1].system;
    expect(systemPrompt).toContain("project-a");
  });

  it("works without embedding service (importance-only)", async () => {
    mockRecallMemories.mockResolvedValue([
      { id: "mem-1", category: "projects", key: "project-a", content: "Info", updatedAt: new Date() },
    ]);

    mockComplete.mockResolvedValue(textResponse("Response text"));

    const { Orchestrator } = await import("../agents/orchestrator.js");
    const { LlmRegistry } = await import("@ai-cofounder/llm");
    const registry = new LlmRegistry();

    const orchestrator = new Orchestrator({
      registry,
      db: {} as any,
    });

    const result = await orchestrator.run("Hello", undefined, [], "user-1");
    expect(result.response).toBe("Response text");
    expect(mockSearchMemoriesByVector).not.toHaveBeenCalled();
  });
});
