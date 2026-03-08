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
vi.mock("@ai-cofounder/db", () => ({
  searchChunksByVector: (...args: unknown[]) => mockSearchChunksByVector(...args),
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

  it("converts distance to similarity score", async () => {
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
        distance: 0.2, // → score = 0.8
      },
    ]);

    const results = await retrieve(mockDb, mockEmbed, "test query");

    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(0.8, 1);
    expect(results[0].content).toBe("test content");
  });

  it("filters results below minScore threshold", async () => {
    mockSearchChunksByVector.mockResolvedValue([
      {
        id: "chunk-1",
        source_type: "git",
        source_id: "/repo",
        content: "relevant",
        metadata: null,
        chunk_index: 0,
        token_count: 5,
        created_at: new Date(),
        distance: 0.1, // score = 0.9, passes
      },
      {
        id: "chunk-2",
        source_type: "git",
        source_id: "/repo",
        content: "irrelevant",
        metadata: null,
        chunk_index: 1,
        token_count: 5,
        created_at: new Date(),
        distance: 0.8, // score = 0.2, filtered
      },
    ]);

    const results = await retrieve(mockDb, mockEmbed, "test", { minScore: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("relevant");
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

  it("diversifies results across sources", async () => {
    const chunks = [
      // 4 chunks from same source
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `same-${i}`,
        source_type: "git" as const,
        source_id: "/same-repo",
        content: `same repo content ${i}`,
        metadata: null,
        chunk_index: i,
        token_count: 5,
        created_at: new Date(),
        distance: 0.05 + i * 0.01,
      })),
      // 2 chunks from different source
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `diff-${i}`,
        source_type: "git" as const,
        source_id: "/diff-repo",
        content: `diff repo content ${i}`,
        metadata: null,
        chunk_index: i,
        token_count: 5,
        created_at: new Date(),
        distance: 0.15 + i * 0.01,
      })),
    ];
    mockSearchChunksByVector.mockResolvedValue(chunks);

    const results = await retrieve(mockDb, mockEmbed, "test", {
      limit: 4,
      diversifySources: true,
    });

    const sourceCounts = new Map<string, number>();
    for (const r of results) {
      sourceCounts.set(r.sourceId, (sourceCounts.get(r.sourceId) ?? 0) + 1);
    }

    // Should have max 2 from same source
    expect(sourceCounts.get("/same-repo")!).toBeLessThanOrEqual(2);
    // Should include chunks from the other source
    expect(sourceCounts.has("/diff-repo")).toBe(true);
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
