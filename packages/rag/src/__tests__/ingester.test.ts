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
const mockInsertChunks = vi.fn().mockResolvedValue([]);
const mockDeleteChunksBySource = vi.fn().mockResolvedValue(undefined);
const mockUpsertIngestionState = vi.fn().mockResolvedValue({ id: "state-1" });
const mockGetIngestionState = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  insertChunks: (...args: unknown[]) => mockInsertChunks(...args),
  deleteChunksBySource: (...args: unknown[]) => mockDeleteChunksBySource(...args),
  upsertIngestionState: (...args: unknown[]) => mockUpsertIngestionState(...args),
  getIngestionState: (...args: unknown[]) => mockGetIngestionState(...args),
}));

// Import AFTER mocks
const { ingestFiles, ingestText, needsReingestion, shouldSkipFile } = await import(
  "../ingester.js"
);

describe("shouldSkipFile", () => {
  it("skips node_modules", () => {
    expect(shouldSkipFile("node_modules/foo/index.js")).toBe(true);
  });

  it("skips .env files", () => {
    expect(shouldSkipFile(".env")).toBe(true);
    expect(shouldSkipFile(".env.local")).toBe(true);
  });

  it("skips dist directory", () => {
    expect(shouldSkipFile("dist/index.js")).toBe(true);
  });

  it("skips lock files", () => {
    expect(shouldSkipFile("package-lock.json")).toBe(true);
  });

  it("skips binary files", () => {
    expect(shouldSkipFile("logo.png")).toBe(true);
    expect(shouldSkipFile("font.woff2")).toBe(true);
  });

  it("allows source files", () => {
    expect(shouldSkipFile("src/index.ts")).toBe(false);
    expect(shouldSkipFile("README.md")).toBe(false);
    expect(shouldSkipFile("packages/db/src/schema.ts")).toBe(false);
  });
});

describe("ingestFiles", () => {
  const mockEmbed = vi.fn();
  const mockDb = {} as Parameters<typeof ingestFiles>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("skips ignored files", async () => {
    const result = await ingestFiles(mockDb, mockEmbed, "git", "/repo", [
      { path: "node_modules/foo/index.js", content: "module.exports = {}" },
      { path: ".env", content: "SECRET=value" },
    ]);

    expect(result.skipped).toBe(true);
    expect(result.chunksCreated).toBe(0);
    expect(mockInsertChunks).not.toHaveBeenCalled();
  });

  it("chunks and embeds source files", async () => {
    const result = await ingestFiles(mockDb, mockEmbed, "git", "/repo", [
      { path: "src/index.ts", content: 'export const hello = "world";', language: "typescript" },
    ]);

    expect(result.skipped).toBe(false);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(mockInsertChunks).toHaveBeenCalled();
    expect(mockDeleteChunksBySource).toHaveBeenCalledWith(mockDb, "git", "/repo");
    expect(mockUpsertIngestionState).toHaveBeenCalled();
  });

  it("continues when embedding fails for a chunk", async () => {
    mockEmbed
      .mockResolvedValueOnce([0.1, 0.2]) // first chunk succeeds
      .mockRejectedValueOnce(new Error("rate limit")); // second fails

    const result = await ingestFiles(mockDb, mockEmbed, "git", "/repo", [
      { path: "src/a.ts", content: "const a = 1;\n".repeat(50) },
      { path: "src/b.ts", content: "const b = 2;\n".repeat(50) },
    ]);

    expect(result.chunksCreated).toBeGreaterThan(0);
    // Should have embedded at least 1, and at least 1 failed
    expect(result.chunksEmbedded).toBeGreaterThanOrEqual(1);
  });

  it("records cursor in ingestion state", async () => {
    await ingestFiles(mockDb, mockEmbed, "git", "/repo", [
      { path: "src/index.ts", content: "const x = 1;" },
    ], { cursor: "abc123sha" });

    expect(mockUpsertIngestionState).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ lastCursor: "abc123sha" }),
    );
  });
});

describe("ingestText", () => {
  const mockEmbed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  const mockDb = {} as Parameters<typeof ingestText>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("ingests a text document and stores chunks", async () => {
    const result = await ingestText(
      mockDb,
      mockEmbed,
      "conversation",
      "conv-123",
      "This is a conversation about building a RAG pipeline.",
    );

    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBeGreaterThan(0);
    expect(mockInsertChunks).toHaveBeenCalled();
  });

  it("includes custom metadata in chunks", async () => {
    await ingestText(
      mockDb,
      mockEmbed,
      "memory",
      "mem-1",
      "Important fact about the project",
      { metadata: { importance: 90 } },
    );

    const insertCall = mockInsertChunks.mock.calls[0];
    const chunks = insertCall[1] as Array<{ metadata: Record<string, unknown> }>;
    expect(chunks[0].metadata).toEqual(
      expect.objectContaining({ importance: 90 }),
    );
  });
});

describe("needsReingestion", () => {
  const mockDb = {} as Parameters<typeof needsReingestion>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when source was never ingested", async () => {
    mockGetIngestionState.mockResolvedValue(null);

    const result = await needsReingestion(mockDb, "git", "/repo", "abc123");
    expect(result).toBe(true);
  });

  it("returns true when cursor has changed", async () => {
    mockGetIngestionState.mockResolvedValue({ lastCursor: "old-sha" });

    const result = await needsReingestion(mockDb, "git", "/repo", "new-sha");
    expect(result).toBe(true);
  });

  it("returns false when cursor matches", async () => {
    mockGetIngestionState.mockResolvedValue({ lastCursor: "same-sha" });

    const result = await needsReingestion(mockDb, "git", "/repo", "same-sha");
    expect(result).toBe(false);
  });
});
