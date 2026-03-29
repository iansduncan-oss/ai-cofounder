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

// Mock @ai-cofounder/llm
const mockComplete = vi.fn();
vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class {
    complete = mockComplete;
  },
}));

// Import AFTER mocks
const { rerank } = await import("../reranker.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

const makeCandidates = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    content: `content for chunk ${i}`,
    sourceType: "git",
    sourceId: "/repo",
    metadata: null,
    chunkIndex: i,
    tokenCount: 10,
    createdAt: new Date(),
    score: 0.01 - i * 0.001, // decreasing RRF scores
  }));

describe("rerank", () => {
  let registry: InstanceType<typeof LlmRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new LlmRegistry();
  });

  it("scores candidates via LLM and returns top-K sorted", async () => {
    const candidates = makeCandidates(5);
    mockComplete.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { index: 0, score: 3 },
            { index: 1, score: 9 },
            { index: 2, score: 5 },
            { index: 3, score: 1 },
            { index: 4, score: 7 },
          ]),
        },
      ],
    });

    const results = await rerank(registry, "test query", candidates, { topK: 3 });

    expect(results).toHaveLength(3);
    // Should be sorted by rerankScore descending
    expect(results[0].rerankScore).toBe(9);
    expect(results[1].rerankScore).toBe(7);
    expect(results[2].rerankScore).toBe(5);
  });

  it("falls back to RRF scores when LLM fails", async () => {
    const candidates = makeCandidates(3);
    mockComplete.mockRejectedValue(new Error("LLM timeout"));

    const results = await rerank(registry, "test query", candidates, { topK: 3 });

    expect(results).toHaveLength(3);
    // Should use the original RRF scores
    results.forEach((r) => {
      expect(r.rerankScore).toBe(r.score);
    });
  });

  it("returns passthrough when enabled: false", async () => {
    const candidates = makeCandidates(5);

    const results = await rerank(registry, "test query", candidates, {
      enabled: false,
      topK: 3,
    });

    expect(results).toHaveLength(3);
    expect(mockComplete).not.toHaveBeenCalled();
    // Should use original scores
    results.forEach((r) => {
      expect(r.rerankScore).toBe(r.score);
    });
  });

  it("handles malformed LLM response gracefully", async () => {
    const candidates = makeCandidates(3);
    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I can't score these." }],
    });

    const results = await rerank(registry, "test query", candidates, { topK: 3 });

    // Should fall back to RRF scores
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r.rerankScore).toBe(r.score);
    });
  });
});
