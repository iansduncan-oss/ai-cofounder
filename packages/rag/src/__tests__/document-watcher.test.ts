import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock @ai-cofounder/queue
const mockEnqueueRagIngestion = vi.fn().mockResolvedValue(undefined);
vi.mock("@ai-cofounder/queue", () => ({
  enqueueRagIngestion: (...args: unknown[]) => mockEnqueueRagIngestion(...args),
}));

// Mock chokidar
const mockOn = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockWatch = vi.fn().mockReturnValue({
  on: mockOn,
  close: mockClose,
});
vi.mock("chokidar", () => ({
  watch: (...args: unknown[]) => mockWatch(...args),
}));

// Mock fs/promises
const mockReadFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Import AFTER mocks — DocumentWatcher is in agent-server, so we test the
// createDocumentWatcher factory and the DocumentWatcher class directly.
// Since document-watcher.ts is in agent-server, we test its logic here
// but import from the right location.

// For this test, we replicate the core logic inline since the watcher lives in agent-server.
// The actual file is at apps/agent-server/src/services/document-watcher.ts
// Here we test the createDocumentWatcher parsing logic and DocumentWatcher behavior.

describe("DocumentWatcher (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and stops cleanly with mock chokidar", async () => {
    // Dynamically import after mocks
    const { DocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    const watcher = new DocumentWatcher([{ path: "/docs", sourceId: "docs" }]);
    await watcher.start();

    expect(mockWatch).toHaveBeenCalledWith(
      ["/docs"],
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    );
    expect(mockOn).toHaveBeenCalledWith("add", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("unlink", expect.any(Function));

    await watcher.stop();
    expect(mockClose).toHaveBeenCalled();
  });

  it("ignores files in excluded directories", async () => {
    const { DocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    const watcher = new DocumentWatcher([{ path: "/docs", sourceId: "docs" }]);
    await watcher.start();

    // Chokidar's ignored option should include node_modules, .git, etc.
    const watchCall = mockWatch.mock.calls[0];
    const options = watchCall[1];
    expect(options.ignored).toEqual(
      expect.arrayContaining([
        expect.stringContaining("node_modules"),
        expect.stringContaining(".git"),
        expect.stringContaining("dist"),
      ]),
    );
  });

  it("skips unchanged files via hash check", async () => {
    const { DocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    const watcher = new DocumentWatcher([{ path: "/docs", sourceId: "docs" }]);
    await watcher.start();

    // Get the "change" handler
    const changeHandler = mockOn.mock.calls.find((c: unknown[]) => c[0] === "change")![1] as (path: string) => Promise<void>;

    // First change: new file content
    mockReadFile.mockResolvedValue("file content v1");
    await changeHandler("/docs/readme.md");

    // Wait for debounce
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockEnqueueRagIngestion).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockReadFile.mockResolvedValue("file content v1"); // same content
    await changeHandler("/docs/readme.md");

    // Same hash, should not enqueue again
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockEnqueueRagIngestion).not.toHaveBeenCalled();

    await watcher.stop();
  });

  it("debounces rapid changes to same source", async () => {
    const { DocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    const watcher = new DocumentWatcher([{ path: "/docs", sourceId: "docs" }]);
    await watcher.start();

    const changeHandler = mockOn.mock.calls.find((c: unknown[]) => c[0] === "change")![1] as (path: string) => Promise<void>;

    // Rapid changes with different content
    let callCount = 0;
    mockReadFile.mockImplementation(async () => `content v${++callCount}`);

    await changeHandler("/docs/file1.md");
    await changeHandler("/docs/file2.md");
    await changeHandler("/docs/file3.md");

    // Before debounce expires, should not have enqueued
    expect(mockEnqueueRagIngestion).not.toHaveBeenCalled();

    // After debounce
    await vi.advanceTimersByTimeAsync(6000);

    // Should have enqueued only once (debounced)
    expect(mockEnqueueRagIngestion).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRagIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "docs" }),
    );

    await watcher.stop();
  });
});

describe("createDocumentWatcher", () => {
  it("parses DOC_WATCH_PATHS correctly", async () => {
    const { createDocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    const watcher = createDocumentWatcher("/path/one:source1,/path/two:source2");
    expect(watcher).not.toBeNull();
  });

  it("returns null for empty/missing env", async () => {
    const { createDocumentWatcher } = await import(
      "../../../../apps/agent-server/src/services/document-watcher.js"
    );

    expect(createDocumentWatcher("")).toBeNull();
    expect(createDocumentWatcher(undefined)).toBeNull();
  });
});
