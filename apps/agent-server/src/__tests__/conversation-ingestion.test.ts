import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { flushPromises, mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock @ai-cofounder/shared ──────────────────────────────────────────────────

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

// ── Mock @ai-cofounder/db ──────────────────────────────────────────────────────

const mockGetConversationMessageCount = vi.fn().mockResolvedValue(5);
const mockSaveConversationSummary = vi.fn().mockResolvedValue({ id: "summary-1" });
const mockGetLatestConversationSummary = vi.fn().mockResolvedValue(null);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getConversationMessageCount: (...args: unknown[]) => mockGetConversationMessageCount(...args),
  saveConversationSummary: (...args: unknown[]) => mockSaveConversationSummary(...args),
  getLatestConversationSummary: (...args: unknown[]) => mockGetLatestConversationSummary(...args),
}));

// ── Mock @ai-cofounder/llm ─────────────────────────────────────────────────────

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Test summary" }],
  model: "test-model",
  stop_reason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 20 },
  provider: "test",
});

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

// ── Mock @ai-cofounder/queue ───────────────────────────────────────────────────

const mockEnqueueRagIngestion = vi.fn().mockResolvedValue("job-1");

vi.mock("@ai-cofounder/queue", () => ({
  enqueueRagIngestion: (...args: unknown[]) => mockEnqueueRagIngestion(...args),
  getRagIngestionQueue: vi.fn(),
}));

// ── Mock @ai-cofounder/rag ─────────────────────────────────────────────────────

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
  ingestText: vi.fn().mockResolvedValue({ chunksCreated: 0 }),
}));

// ── Import modules under test ──────────────────────────────────────────────────

const { ConversationIngestionService } = await import("../services/conversation-ingestion.js");
const { executeSharedTool } = await import("../agents/tool-executor.js");

// ─── Test helpers ──────────────────────────────────────────────────────────────

const db = {} as Parameters<typeof ConversationIngestionService.prototype.ingestAfterResponse>[0];
const registry = { complete: mockComplete, completeDirect: mockComplete } as Parameters<typeof ConversationIngestionService.prototype.ingestAfterResponse>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConversationMessageCount.mockResolvedValue(5);
  mockSaveConversationSummary.mockResolvedValue({ id: "summary-1" });
  mockEnqueueRagIngestion.mockResolvedValue("job-1");
  mockComplete.mockResolvedValue({
    content: [{ type: "text", text: "Test summary" }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("conversation ingestion", () => {
  it("ingestAfterResponse creates eager summary for short conversations (< 30 messages)", async () => {
    mockGetConversationMessageCount.mockResolvedValue(5);

    const service = new ConversationIngestionService(db as any, registry as any);
    await service.ingestAfterResponse("conv-1", "Hello", "Hi there!");

    // summarizeMessages internally calls registry.complete
    expect(mockComplete).toHaveBeenCalledOnce();

    // saveConversationSummary called with the summary text
    expect(mockSaveConversationSummary).toHaveBeenCalledOnce();
    const saveCall = mockSaveConversationSummary.mock.calls[0][1];
    expect(saveCall.conversationId).toBe("conv-1");
    expect(typeof saveCall.summary).toBe("string");

    // RAG ingestion enqueued with ingest_conversations action
    expect(mockEnqueueRagIngestion).toHaveBeenCalledOnce();
    expect(mockEnqueueRagIngestion.mock.calls[0][0]).toMatchObject({
      action: "ingest_conversations",
      sourceId: "conv-1",
    });
  });

  it("ingestAfterResponse skips eager summary for long conversations (>= 30 messages)", async () => {
    mockGetConversationMessageCount.mockResolvedValue(35);

    const service = new ConversationIngestionService(db as any, registry as any);
    await service.ingestAfterResponse("conv-1", "Hello", "Hi there!");

    // summarizeMessages NOT called — lazy path handles long conversations
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockSaveConversationSummary).not.toHaveBeenCalled();

    // RAG ingestion still enqueued
    expect(mockEnqueueRagIngestion).toHaveBeenCalledOnce();
    expect(mockEnqueueRagIngestion.mock.calls[0][0]).toMatchObject({
      action: "ingest_conversations",
      sourceId: "conv-1",
    });
  });

  it("ingestAfterResponse is non-fatal on errors", async () => {
    mockGetConversationMessageCount.mockRejectedValue(new Error("DB connection failed"));

    const service = new ConversationIngestionService(db as any, registry as any);

    // Should not throw — errors are caught and logged as warn
    await expect(service.ingestAfterResponse("conv-1", "Hello", "Hi")).resolves.toBeUndefined();

    // Nothing should have been enqueued
    expect(mockEnqueueRagIngestion).not.toHaveBeenCalled();
  });

  it("works with an embedding service provided", async () => {
    mockGetConversationMessageCount.mockResolvedValue(5);

    const embeddingService = { embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)) };
    const service = new ConversationIngestionService(db as any, registry as any, embeddingService as any);
    await service.ingestAfterResponse("conv-2", "Test message", "Test response");

    expect(mockSaveConversationSummary).toHaveBeenCalledOnce();
    expect(mockEnqueueRagIngestion).toHaveBeenCalledOnce();
  });
});

describe("project ingestion", () => {
  it("git_clone triggers ingest_repo enqueue on success", async () => {
    const mockWorkspaceService = {
      gitClone: vi.fn().mockResolvedValue({ cloned: true, directory: "my-repo" }),
    };

    const result = await executeSharedTool(
      {
        type: "tool_use",
        id: "test-1",
        name: "git_clone",
        input: {
          repo_url: "https://github.com/example/my-repo.git",
          directory_name: "my-repo",
        },
      },
      { workspaceService: mockWorkspaceService as any },
      { conversationId: "conv-1" },
    );

    // Should return clone result
    expect(result).toMatchObject({ cloned: true, repoUrl: "https://github.com/example/my-repo.git" });

    // Give fire-and-forget a microtask tick to execute
    await flushPromises();

    // RAG ingestion enqueued with ingest_repo action
    expect(mockEnqueueRagIngestion).toHaveBeenCalledOnce();
    expect(mockEnqueueRagIngestion.mock.calls[0][0]).toMatchObject({
      action: "ingest_repo",
      sourceId: "my-repo",
    });
  });

  it("git_clone derives directory name from repo URL when directory_name not provided", async () => {
    const mockWorkspaceService = {
      gitClone: vi.fn().mockResolvedValue({ cloned: true, directory: "ai-cofounder" }),
    };

    await executeSharedTool(
      {
        type: "tool_use",
        id: "test-2",
        name: "git_clone",
        input: {
          repo_url: "https://github.com/example/ai-cofounder.git",
        },
      },
      { workspaceService: mockWorkspaceService as any },
      { conversationId: "conv-1" },
    );

    await flushPromises();

    expect(mockEnqueueRagIngestion).toHaveBeenCalledOnce();
    expect(mockEnqueueRagIngestion.mock.calls[0][0]).toMatchObject({
      action: "ingest_repo",
      sourceId: "ai-cofounder",
    });
  });

  it("git_clone ingest_repo is fire-and-forget (non-fatal if queue errors)", async () => {
    mockEnqueueRagIngestion.mockRejectedValue(new Error("Redis unavailable"));

    const mockWorkspaceService = {
      gitClone: vi.fn().mockResolvedValue({ cloned: true, directory: "my-repo" }),
    };

    // Should still return the clone result even if RAG enqueueing fails
    const result = await executeSharedTool(
      {
        type: "tool_use",
        id: "test-3",
        name: "git_clone",
        input: {
          repo_url: "https://github.com/example/my-repo.git",
          directory_name: "my-repo",
        },
      },
      { workspaceService: mockWorkspaceService as any },
      { conversationId: "conv-1" },
    );

    expect(result).toMatchObject({ cloned: true });
  });
});
