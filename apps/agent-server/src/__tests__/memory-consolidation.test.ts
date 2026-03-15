import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// 1. Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// 2. Mock @ai-cofounder/db with mockDbModule spread + custom saveMemory
const mockSaveMemory = vi.fn().mockResolvedValue({ id: "composite-1", key: "Cluster title", category: "decisions" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  memories: {
    userId: "userId_col",
    metadata: "metadata_col",
    category: "category_col",
    id: "id_col",
    createdAt: "createdAt_col",
    key: "key_col",
    content: "content_col",
  },
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
}));

// 3. Mock @ai-cofounder/llm
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

// 4. Mock @ai-cofounder/rag
vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

// 5. Mock drizzle-orm operators — return descriptive strings for easy debugging
vi.mock("drizzle-orm", async () => {
  const actual = {} as Record<string, unknown>;
  actual.eq = vi.fn((a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`);
  actual.and = vi.fn((...args: unknown[]) => `and(${args.join(",")})`);
  actual.desc = vi.fn((a: unknown) => `desc(${String(a)})`);
  // sql tag must be callable as tagged template and also as function
  const sqlFn = Object.assign(
    (..._args: unknown[]) => "sql-expr",
    { raw: () => "sql-raw" },
  );
  actual.sql = sqlFn;
  return actual;
});

/**
 * Creates a mock db object with configurable return values for Drizzle query chains.
 *
 * The key insight: Drizzle calls are fully chained like:
 *   db.selectDistinct({...}).from(table).where(condition)       — no limit, awaitable at .where()
 *   db.select().from(table).where(condition).orderBy(...).limit(n) — awaitable at .limit()
 *   db.update(table).set({...}).where(condition)               — awaitable at .where()
 */
function createMockDb({
  userIds,
  userMemories,
  updateResult = undefined,
}: {
  userIds: { userId: string }[];
  userMemories: unknown[];
  updateResult?: unknown;
}) {
  const mockUpdateWhere = vi.fn().mockResolvedValue(updateResult);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  // The select chain for user memories: .select().from().where().orderBy().limit()
  const mockSelectLimit = vi.fn().mockResolvedValue(userMemories);
  const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  // The selectDistinct chain: .selectDistinct().from().where()  — terminal is .where()
  const mockDistinctWhere = vi.fn().mockResolvedValue(userIds);
  const mockDistinctFrom = vi.fn().mockReturnValue({ where: mockDistinctWhere });
  const mockSelectDistinct = vi.fn().mockReturnValue({ from: mockDistinctFrom });

  const db = {
    selectDistinct: mockSelectDistinct,
    select: mockSelect,
    update: mockUpdate,
  };

  return {
    db,
    mockUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    mockSelect,
    mockSelectDistinct,
  };
}

describe("consolidation", () => {
  let MemoryConsolidationService: typeof import("../services/memory-consolidation.js").MemoryConsolidationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ MemoryConsolidationService } = await import("../services/memory-consolidation.js"));
  });

  it("skips consolidation when fewer than 5 non-consolidated memories per user", async () => {
    const { db } = createMockDb({
      userIds: [{ userId: "user-1" }],
      userMemories: [
        { id: "m1", userId: "user-1", category: "decisions", key: "key1", content: "content1", metadata: null },
        { id: "m2", userId: "user-1", category: "decisions", key: "key2", content: "content2", metadata: null },
        { id: "m3", userId: "user-1", category: "decisions", key: "key3", content: "content3", metadata: null },
      ],
    });

    const mockLlm = { complete: mockComplete, getProviderHealth: vi.fn().mockReturnValue([]) };
    const svc = new MemoryConsolidationService(
      db as unknown as Parameters<typeof MemoryConsolidationService>[0],
      mockLlm as unknown as Parameters<typeof MemoryConsolidationService>[1],
    );
    const result = await svc.consolidate();

    // LLM should NOT be called (only 3 memories, below threshold of 5)
    expect(mockComplete).not.toHaveBeenCalled();
    expect(result).toEqual({ consolidated: 0, created: 0 });
  });

  it("consolidates related memories per-user into composite entries", async () => {
    const decisionsMemories = [
      { id: "m1", userId: "user-1", category: "decisions", key: "Use Postgres", content: "We decided to use Postgres for our database", metadata: null },
      { id: "m2", userId: "user-1", category: "decisions", key: "Use TypeScript", content: "We decided to use TypeScript", metadata: null },
      { id: "m3", userId: "user-1", category: "decisions", key: "Use React", content: "We decided to use React for the frontend", metadata: null },
      { id: "m4", userId: "user-1", category: "decisions", key: "Use Tailwind", content: "We decided to use Tailwind CSS", metadata: null },
      { id: "m5", userId: "user-1", category: "decisions", key: "Deploy to Hetzner", content: "Deploy on Hetzner VPS for hosting", metadata: null },
    ];

    const { db, mockUpdate, mockUpdateSet, mockUpdateWhere } = createMockDb({
      userIds: [{ userId: "user-1" }],
      userMemories: decisionsMemories,
    });

    // LLM returns clusters with 2 related memories each
    const clusteredResponse = JSON.stringify({
      clusters: [
        {
          title: "Frontend Technology Decisions",
          summary: "We decided to use React with Tailwind CSS for the frontend.",
          memberIds: ["m3", "m4"],
        },
      ],
    });

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: clusteredResponse }],
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "test",
      provider: "test",
      stop_reason: "end_turn",
    });

    const mockLlm = { complete: mockComplete, getProviderHealth: vi.fn().mockReturnValue([]) };
    const svc = new MemoryConsolidationService(
      db as unknown as Parameters<typeof MemoryConsolidationService>[0],
      mockLlm as unknown as Parameters<typeof MemoryConsolidationService>[1],
    );
    const result = await svc.consolidate();

    // saveMemory should be called for the cluster with correct userId
    expect(mockSaveMemory).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "user-1",
        category: "decisions",
        metadata: expect.objectContaining({ consolidated_from: ["m3", "m4"] }),
      }),
    );

    // Members should be marked as consolidated (db.update called for each member)
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalled();
    expect(mockUpdateWhere).toHaveBeenCalled();

    expect(result.created).toBeGreaterThanOrEqual(1);
    expect(result.consolidated).toBeGreaterThanOrEqual(2); // m3 and m4 marked
  });

  it("marks constituent memories with consolidated flag", async () => {
    const testMemories = [
      { id: "m1", userId: "user-1", category: "preferences", key: "pref1", content: "content1", metadata: null },
      { id: "m2", userId: "user-1", category: "preferences", key: "pref2", content: "content2", metadata: null },
      { id: "m3", userId: "user-1", category: "preferences", key: "pref3", content: "content3", metadata: null },
      { id: "m4", userId: "user-1", category: "preferences", key: "pref4", content: "content4", metadata: null },
      { id: "m5", userId: "user-1", category: "preferences", key: "pref5", content: "content5", metadata: null },
    ];

    const { db, mockUpdate } = createMockDb({
      userIds: [{ userId: "user-1" }],
      userMemories: testMemories,
    });

    mockSaveMemory.mockResolvedValue({ id: "composite-xyz", key: "Cluster", category: "preferences" });

    // LLM returns a cluster of 3 members
    const clusteredResponse = JSON.stringify({
      clusters: [
        {
          title: "Related Preferences Cluster",
          summary: "A cluster of related preferences.",
          memberIds: ["m1", "m2", "m3"],
        },
      ],
    });

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: clusteredResponse }],
      usage: { inputTokens: 50, outputTokens: 30 },
      model: "test",
      provider: "test",
      stop_reason: "end_turn",
    });

    const mockLlm = { complete: mockComplete, getProviderHealth: vi.fn().mockReturnValue([]) };
    const svc = new MemoryConsolidationService(
      db as unknown as Parameters<typeof MemoryConsolidationService>[0],
      mockLlm as unknown as Parameters<typeof MemoryConsolidationService>[1],
    );
    await svc.consolidate();

    // db.update should be called for each member (m1, m2, m3 = 3 times)
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });

  it("handles LLM failure gracefully", async () => {
    const testMemories = [
      { id: "m1", userId: "user-1", category: "preferences", key: "pref1", content: "content1", metadata: null },
      { id: "m2", userId: "user-1", category: "preferences", key: "pref2", content: "content2", metadata: null },
      { id: "m3", userId: "user-1", category: "preferences", key: "pref3", content: "content3", metadata: null },
      { id: "m4", userId: "user-1", category: "preferences", key: "pref4", content: "content4", metadata: null },
      { id: "m5", userId: "user-1", category: "preferences", key: "pref5", content: "content5", metadata: null },
    ];

    const { db } = createMockDb({
      userIds: [{ userId: "user-1" }],
      userMemories: testMemories,
    });

    // LLM throws an error
    mockComplete.mockRejectedValue(new Error("LLM service unavailable"));

    const mockLlm = { complete: mockComplete, getProviderHealth: vi.fn().mockReturnValue([]) };
    const svc = new MemoryConsolidationService(
      db as unknown as Parameters<typeof MemoryConsolidationService>[0],
      mockLlm as unknown as Parameters<typeof MemoryConsolidationService>[1],
    );

    // Should not throw
    await expect(svc.consolidate()).resolves.toEqual({ consolidated: 0, created: 0 });

    // saveMemory should NOT be called
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });
});
