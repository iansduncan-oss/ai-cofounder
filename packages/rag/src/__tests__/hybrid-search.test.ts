import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// Mock @ai-cofounder/db
const mockSearchChunksByVector = vi.fn();
const mockSearchChunksByText = vi.fn();
vi.mock("@ai-cofounder/db", () => ({
  searchChunksByVector: (...args: unknown[]) => mockSearchChunksByVector(...args),
  searchChunksByText: (...args: unknown[]) => mockSearchChunksByText(...args),
}));

// Import AFTER mocks
const { computeRRF, hybridSearch } = await import("../hybrid-search.js");

const makeChunk = (id: string, rank: number) => ({
  id,
  source_type: "git",
  source_id: "/repo",
  content: `content for ${id}`,
  metadata: null,
  chunk_index: rank,
  token_count: 10,
  created_at: new Date(),
  distance: rank * 0.1,
  rank: 1 / (rank + 1),
});

describe("computeRRF", () => {
  it("correctly fuses two ranked lists", () => {
    const vectorResults = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const textResults = [{ id: "b" }, { id: "d" }, { id: "a" }];

    const scores = computeRRF(vectorResults, textResults, 0.6, 0.4, 60);

    // "b" appears in both lists (rank 2 in vector, rank 1 in text)
    // "a" appears in both lists (rank 1 in vector, rank 3 in text)
    const scoreB = scores.get("b")!;
    const scoreA = scores.get("a")!;

    // "b" should score higher than "a" because it's rank 1 in text (weighted 0.4)
    // and rank 2 in vector (weighted 0.6)
    // a: 0.6/(60+1) + 0.4/(60+3) = 0.00984 + 0.00635 = 0.01619
    // b: 0.6/(60+2) + 0.4/(60+1) = 0.00968 + 0.00656 = 0.01624
    expect(scoreB).toBeGreaterThan(scoreA);

    // "d" only appears in text
    expect(scores.has("d")).toBe(true);
    // "c" only appears in vector
    expect(scores.has("c")).toBe(true);
  });
});

describe("hybridSearch", () => {
  const mockEmbed = vi.fn();
  const mockDb = {} as Parameters<typeof hybridSearch>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSearchChunksByVector.mockResolvedValue([]);
    mockSearchChunksByText.mockResolvedValue([]);
  });

  it("runs vector + text in parallel, returns merged results", async () => {
    mockSearchChunksByVector.mockResolvedValue([makeChunk("a", 0), makeChunk("b", 1)]);
    mockSearchChunksByText.mockResolvedValue([makeChunk("b", 0), makeChunk("c", 1)]);

    const results = await hybridSearch(mockDb, mockEmbed, "test query", { limit: 10 });

    // Should have 3 unique chunks: a, b, c
    expect(results).toHaveLength(3);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");

    // "b" appears in both, should have highest score
    expect(results[0].id).toBe("b");
  });

  it("falls back to text-only when embedding fails", async () => {
    mockEmbed.mockRejectedValue(new Error("API error"));
    mockSearchChunksByText.mockResolvedValue([makeChunk("text-1", 0), makeChunk("text-2", 1)]);

    const results = await hybridSearch(mockDb, mockEmbed, "test query");

    expect(results).toHaveLength(2);
    expect(mockSearchChunksByVector).not.toHaveBeenCalled();
  });

  it("returns empty when both searches return nothing", async () => {
    mockSearchChunksByVector.mockResolvedValue([]);
    mockSearchChunksByText.mockResolvedValue([]);

    const results = await hybridSearch(mockDb, mockEmbed, "test query");
    expect(results).toHaveLength(0);
  });

  it("deduplicates chunks appearing in both result sets", async () => {
    const shared = makeChunk("shared", 0);
    mockSearchChunksByVector.mockResolvedValue([shared]);
    mockSearchChunksByText.mockResolvedValue([shared]);

    const results = await hybridSearch(mockDb, mockEmbed, "test query");

    // Should appear only once
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("shared");
    // Score should combine both rankings
    expect(results[0].score).toBeGreaterThan(0);
  });
});
