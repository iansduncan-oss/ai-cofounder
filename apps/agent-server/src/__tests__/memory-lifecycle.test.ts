import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTestEnv } from "@ai-cofounder/test-utils";
import { mockDbModule } from "@ai-cofounder/test-utils";

setupTestEnv();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_n: string, d: string) => d,
}));

const mockDb = mockDbModule();
vi.mock("@ai-cofounder/db", () => mockDb);

const { MemoryLifecycleService } = await import("../services/memory-lifecycle.js");

describe("MemoryLifecycleService", () => {
  let service: InstanceType<typeof MemoryLifecycleService>;
  const fakeDb = { update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }) };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemoryLifecycleService(fakeDb as never);
  });

  it("archives stale memories below threshold", async () => {
    mockDb.listMemoriesForDecay.mockResolvedValueOnce([
      { id: "m-1", importance: 5, lastAccessedAt: new Date(), createdAt: new Date() },
      { id: "m-2", importance: 50, lastAccessedAt: new Date(), createdAt: new Date() },
    ]);
    const result = await service.archiveStale("user-1");
    expect(result.archived).toBe(1); // m-1 (importance 5) below threshold 10
    expect(mockDb.archiveMemory).toHaveBeenCalledWith(expect.anything(), "m-1");
  });

  it("enforces budget by archiving lowest importance", async () => {
    mockDb.countActiveMemories.mockResolvedValueOnce(10003);
    mockDb.listMemoriesForDecay.mockResolvedValueOnce([
      { id: "m-low", importance: 1 },
      { id: "m-mid", importance: 30 },
      { id: "m-high", importance: 90 },
    ]);
    // Budget is 10000, excess is 3
    const result = await service.enforceBudget("user-1");
    expect(result.archived).toBe(3);
  });

  it("skips budget enforcement when under limit", async () => {
    mockDb.countActiveMemories.mockResolvedValueOnce(100);
    const result = await service.enforceBudget("user-1");
    expect(result.archived).toBe(0);
  });

  it("runs full lifecycle", async () => {
    mockDb.listMemoriesForDecay.mockResolvedValue([]);
    mockDb.countActiveMemories.mockResolvedValue(0);
    const result = await service.runFullLifecycle("user-1");
    expect(result).toHaveProperty("decayed");
    expect(result).toHaveProperty("archived");
    expect(result).toHaveProperty("budgetArchived");
  });
});
