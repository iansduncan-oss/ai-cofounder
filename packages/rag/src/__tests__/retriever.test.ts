import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock @ai-cofounder/db
const mockSearchChunksByVector = vi.fn();
const mockSearchChunksByText = vi.fn().mockResolvedValue([]);
vi.mock("@ai-cofounder/db", () => ({
  searchChunksByVector: (...args: unknown[]) => mockSearchChunksByVector(...args),
  searchChunksByText: (...args: unknown[]) => mockSearchChunksByText(...args),
}));

// Mock @ai-cofounder/llm (used by reranker, imported by retriever)
vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class {},
}));

// Import AFTER mocks
const { retrieve, formatContext } = await import("../retriever.js");

describe("retrieve", () => {
  const mockEmbed = vi.fn();
  const mockDb = {} as Parameters<typeof retrieve>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("returns empty array when embedding fails", async () => {
    mockEmbed.mockRejectedValue(new Error("API error"));

    const results = await retrieve(mockDb, mockEmbed, "test query");
    expect(results).toEqual([]);
  });

  it("returns empty array when no candidates found", async () => {
    mockSearchChunksByVector.mockResolvedValue([]);

    const results = await retrieve(mockDb, mockEmbed, "test query");
    expect(results).toEqual([]);
  });

  it("returns results with RRF scores from hybrid search", async () => {
    mockSearchChunksByVector.mockResolvedValue([
      {
        id: "chunk-1",
        source_type: "git",
        source_id: "/repo",
        content: "test content",
        metadata: { filePath: "src/test.ts" },
        chunk_index: 0,
        token_count: 10,
        created_at: new Date(),
        distance: 0.2,
      },
    ]);

    const results = await retrieve(mockDb, mockEmbed, "test query");

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0); // RRF score
    expect(results[0].content).toBe("test content");
  });

  it("returns both vector and text results via hybrid search", async () => {
    mockSearchChunksByVector.mockResolvedValue([
      {
        id: "chunk-vec",
        source_type: "git",
        source_id: "/repo",
        content: "vector match",
        metadata: null,
        chunk_index: 0,
        token_count: 5,
        created_at: new Date(),
        distance: 0.1,
      },
    ]);
    mockSearchChunksByText.mockResolvedValue([
      {
        id: "chunk-text",
        source_type: "git",
        source_id: "/repo",
        content: "text match",
        metadata: null,
        chunk_index: 1,
        token_count: 5,
        created_at: new Date(),
        rank: 0.5,
      },
    ]);

    const results = await retrieve(mockDb, mockEmbed, "test", { limit: 5 });

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("chunk-vec");
    expect(ids).toContain("chunk-text");
  });

  it("respects limit parameter", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `chunk-${i}`,
      source_type: "git",
      source_id: `/repo-${i}`,
      content: `content ${i}`,
      metadata: null,
      chunk_index: 0,
      token_count: 5,
      created_at: new Date(),
      distance: 0.1 + i * 0.02,
    }));
    mockSearchChunksByVector.mockResolvedValue(chunks);

    const results = await retrieve(mockDb, mockEmbed, "test", { limit: 3 });

    expect(results).toHaveLength(3);
  });

  it("returns results sorted by RRF score", async () => {
    // Chunks in vector results — lower distance = higher rank
    const chunks = Array.from({ length: 4 }, (_, i) => ({
      id: `chunk-${i}`,
      source_type: "git" as const,
      source_id: `/repo-${i}`,
      content: `content ${i}`,
      metadata: null,
      chunk_index: i,
      token_count: 5,
      created_at: new Date(),
      distance: 0.05 + i * 0.05,
    }));
    mockSearchChunksByVector.mockResolvedValue(chunks);

    const results = await retrieve(mockDb, mockEmbed, "test", { limit: 4 });

    expect(results).toHaveLength(4);
    // First result should have highest score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("passes sourceType filter to vector search", async () => {
    mockSearchChunksByVector.mockResolvedValue([]);

    await retrieve(mockDb, mockEmbed, "test", { sourceType: "conversation" });

    expect(mockSearchChunksByVector).toHaveBeenCalledWith(
      mockDb,
      expect.any(Array),
      expect.objectContaining({ sourceType: "conversation" }),
    );
  });
});

describe("formatContext", () => {
  it("returns empty string for no chunks", () => {
    expect(formatContext([])).toBe("");
  });

  it("formats chunks with source info and scores", () => {
    const chunks = [
      {
        id: "1",
        content: "function hello() { return 'world'; }",
        sourceType: "git",
        sourceId: "/repo",
        distance: 0.1,
        score: 0.9,
        metadata: { filePath: "src/hello.ts" },
        tokenCount: 10,
      },
    ];

    const formatted = formatContext(chunks);

    expect(formatted).toContain("Retrieved context:");
    expect(formatted).toContain("[git] src/hello.ts");
    expect(formatted).toContain("90% match");
    expect(formatted).toContain("function hello()");
  });

  it("uses sourceId when filePath not in metadata", () => {
    const chunks = [
      {
        id: "1",
        content: "some text",
        sourceType: "conversation",
        sourceId: "conv-123",
        distance: 0.2,
        score: 0.8,
        metadata: null,
        tokenCount: 5,
      },
    ];

    const formatted = formatContext(chunks);
    expect(formatted).toContain("conv-123");
  });
});
