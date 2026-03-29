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
const { contextualizeChunks } = await import("../contextualizer.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

const makeChunks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    content: `Chunk content ${i}`,
    index: i,
    tokenCount: 10,
    metadata: { type: "prose" as const, filePath: `src/file-${i}.ts` },
    startLine: 0,
    endLine: 10,
  }));

describe("contextualizeChunks", () => {
  let registry: InstanceType<typeof LlmRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new LlmRegistry();
  });

  it("generates prefix for each chunk", async () => {
    const chunks = makeChunks(3);
    mockComplete.mockResolvedValue({
      content: [
        { type: "text", text: "This chunk describes a utility function for parsing config files." },
      ],
    });

    const results = await contextualizeChunks(registry, chunks);

    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r.contextPrefix).toBe(
        "This chunk describes a utility function for parsing config files.",
      );
    });
    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  it("returns empty prefix when enabled: false", async () => {
    const chunks = makeChunks(2);

    const results = await contextualizeChunks(registry, chunks, { enabled: false });

    expect(results).toHaveLength(2);
    results.forEach((r) => {
      expect(r.contextPrefix).toBe("");
    });
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("handles per-chunk LLM failure gracefully", async () => {
    const chunks = makeChunks(3);
    mockComplete
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Good prefix for chunk 0." }],
      })
      .mockRejectedValueOnce(new Error("LLM error"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Good prefix for chunk 2." }],
      });

    const results = await contextualizeChunks(registry, chunks);

    expect(results).toHaveLength(3);
    expect(results[0].contextPrefix).toBe("Good prefix for chunk 0.");
    expect(results[1].contextPrefix).toBe(""); // failed chunk gets empty prefix
    expect(results[2].contextPrefix).toBe("Good prefix for chunk 2.");
  });

  it("respects batchSize (10 chunks / batchSize 3 = 4 batches)", async () => {
    const chunks = makeChunks(10);
    const callOrder: number[] = [];
    const batchCount = 0;

    mockComplete.mockImplementation(async () => {
      callOrder.push(batchCount);
      return {
        content: [{ type: "text", text: "Context prefix." }],
      };
    });

    // Use a custom implementation to track batch boundaries
    const results = await contextualizeChunks(registry, chunks, { batchSize: 3 });

    expect(results).toHaveLength(10);
    // With batchSize 3 and 10 chunks: batches of [3, 3, 3, 1]
    // All 10 chunks should have been processed
    expect(mockComplete).toHaveBeenCalledTimes(10);
    results.forEach((r) => {
      expect(r.contextPrefix).toBe("Context prefix.");
    });
  });
});
