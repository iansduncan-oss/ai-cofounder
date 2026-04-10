import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// 1. Mock @ai-cofounder/shared
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

// 2. Mock @ai-cofounder/db
const mockListToolTierConfigs = vi.fn().mockResolvedValue([]);
const mockCreateApproval = vi.fn().mockResolvedValue({ id: "approval-1", taskId: null, status: "pending" });
const mockGetApproval = vi.fn().mockResolvedValue(null);
const mockResolveApproval = vi.fn().mockResolvedValue({ id: "approval-1", status: "rejected" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listToolTierConfigs: (...args: unknown[]) => mockListToolTierConfigs(...args),
  createApproval: (...args: unknown[]) => mockCreateApproval(...args),
  getApproval: (...args: unknown[]) => mockGetApproval(...args),
  resolveApproval: (...args: unknown[]) => mockResolveApproval(...args),
}));

// 3. Mock @ai-cofounder/llm
vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn();
    completeDirect = vi.fn();
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

// 5. Mock notifications (avoid env var requirements)
vi.mock("../services/notifications.js", () => ({
  notifyApprovalCreated: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
const { AutonomyTierService } = await import("../services/autonomy-tier.js");
const { buildSharedToolList, executeWithTierCheck } = await import("../agents/tool-executor.js");
const { notifyApprovalCreated } = await import("../services/notifications.js");

 
const mockDb = {} as any;

describe("AutonomyTierService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListToolTierConfigs.mockResolvedValue([]);
  });

  it("returns green for unknown tools (default)", async () => {
    const service = new AutonomyTierService(mockDb);
    await service.load();
    expect(service.getTier("unknown_tool")).toBe("green");
  });

  it("returns correct default tiers for dangerous tools when DB has no config", async () => {
    const service = new AutonomyTierService(mockDb);
    await service.load();
    // Yellow: destructive or high-impact (git_push promoted from red)
    expect(service.getTier("git_push")).toBe("yellow");
    expect(service.getTier("delete_file")).toBe("yellow");
    expect(service.getTier("delete_directory")).toBe("yellow");
    expect(service.getTier("write_file")).toBe("yellow");
    expect(service.getTier("create_pr")).toBe("yellow");
    expect(service.getTier("git_commit")).toBe("yellow");
  });

  it("DB config overrides static defaults", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "git_push", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    // DB says green, static default says red — DB wins
    expect(service.getTier("git_push")).toBe("green");
    // delete_file still uses static default since not in DB
    expect(service.getTier("delete_file")).toBe("yellow");
  });

  it("returns configured tier after load", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "git_push", tier: "yellow", timeoutMs: 60000 },
      { toolName: "delete_file", tier: "red", timeoutMs: 300000 },
      { toolName: "save_memory", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    expect(service.getTier("git_push")).toBe("yellow");
    expect(service.getTier("delete_file")).toBe("red");
    expect(service.getTier("save_memory")).toBe("green");
  });

  it("returns correct timeoutMs for configured tools", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "git_push", tier: "yellow", timeoutMs: 60000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    expect(service.getTimeoutMs("git_push")).toBe(60000);
  });

  it("returns 300000ms default for unconfigured tools", async () => {
    const service = new AutonomyTierService(mockDb);
    await service.load();
    expect(service.getTimeoutMs("unknown_tool")).toBe(300_000);
  });

  it("getAllRed includes both DB and hardcoded default red tools", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "delete_file", tier: "red", timeoutMs: 300000 },
      { toolName: "delete_directory", tier: "red", timeoutMs: 300000 },
      { toolName: "save_memory", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    const redTools = service.getAllRed();
    // DB red: delete_file, delete_directory (no hardcoded red tools)
    expect(redTools).toContain("delete_file");
    expect(redTools).toContain("delete_directory");
    expect(redTools).not.toContain("save_memory");
    expect(redTools).toHaveLength(2);
  });

  it("getAllRed deduplicates when tool is red in both DB and defaults", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "delete_file", tier: "red", timeoutMs: 60000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    const redTools = service.getAllRed();
    const deleteFileCount = redTools.filter((t) => t === "delete_file").length;
    expect(deleteFileCount).toBe(1);
  });

  it("getAllRed returns empty when no red tools in DB or defaults", async () => {
    const service = new AutonomyTierService(mockDb);
    await service.load();
    const redTools = service.getAllRed();
    expect(redTools).toHaveLength(0);
  });

  it("reload refreshes tier data from DB", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "git_push", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();
    expect(service.getTier("git_push")).toBe("green");

    // Change DB state
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "git_push", tier: "red", timeoutMs: 300000 },
    ]);
    await service.reload();
    expect(service.getTier("git_push")).toBe("red");
  });
});

describe("buildSharedToolList with AutonomyTierService", () => {
  it("excludes red-tier tools from the tool list", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "red", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    const tools = buildSharedToolList({}, undefined, service);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("search_web");
  });

  it("includes green-tier tools in the tool list", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    const tools = buildSharedToolList({}, undefined, service);
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_web");
  });

  it("includes all tools when no tier service provided (backward compat)", () => {
    const tools = buildSharedToolList({});
    // search_web and browse_web are always available
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_web");
    expect(names).toContain("browse_web");
  });
});

describe("executeWithTierCheck", () => {
  const mockBlock = {
    type: "tool_use" as const,
    id: "tool-1",
    name: "search_web",
    input: { query: "test query" },
  };

  const mockContext = {
    conversationId: "conv-1",
    userId: "user-1",
    agentRole: "orchestrator",
    goalId: "goal-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListToolTierConfigs.mockResolvedValue([]);
  });

  it("passes green-tier tools through to executeSharedTool", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "green", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    // search_web tool calls executeWebSearch — mock it at module level is not needed
    // executeWithTierCheck for green will call executeSharedTool which handles the tool
    const result = await executeWithTierCheck(
      mockBlock,
      { db: mockDb, autonomyTierService: service },
      mockContext,
    );
    // search_web returns results or handles gracefully — it should NOT be blocked as red-tier
    expect(result).not.toHaveProperty("error", expect.stringContaining("red tier"));
    expect(typeof result).toBe("object");
    // No approval should have been created (green tier bypasses approval)
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });

  it("blocks red-tier tools with error, never calls DB or notifications", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "red", timeoutMs: 300000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    const result = await executeWithTierCheck(
      mockBlock,
      { db: mockDb, autonomyTierService: service },
      mockContext,
    ) as { error: string };

    expect(result.error).toContain("red tier");
    expect(result.error).toContain("search_web");
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });

  it("returns green behavior when no tier service (backward compat)", async () => {
    const result = await executeWithTierCheck(
      mockBlock,
      { db: mockDb },
      mockContext,
    );
    // Should not have created any approval
    expect(mockCreateApproval).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("yellow-tier: creates approval and notifies", async () => {
    vi.useFakeTimers();

    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "yellow", timeoutMs: 5000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    mockCreateApproval.mockResolvedValue({ id: "approval-1", taskId: "goal-1", status: "pending" });
    // Mock getApproval to return approved immediately after first poll
    let callCount = 0;
    mockGetApproval.mockImplementation(async () => {
      callCount++;
      if (callCount >= 1) {
        return { id: "approval-1", status: "approved", decision: null };
      }
      return { id: "approval-1", status: "pending", decision: null };
    });

    const resultPromise = executeWithTierCheck(
      mockBlock,
      { db: mockDb, autonomyTierService: service },
      mockContext,
    );

    // Advance timers to get past the poll interval (2000ms)
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockCreateApproval).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ requestedBy: "orchestrator" }),
    );
    expect(notifyApprovalCreated).toHaveBeenCalled();
    // Result should be defined (approval went through)
    expect(result).toBeDefined();

    vi.useRealTimers();
  });

  it("yellow-tier: returns error on rejection", async () => {
    vi.useFakeTimers();

    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "yellow", timeoutMs: 10000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    mockCreateApproval.mockResolvedValue({ id: "approval-2", taskId: null, status: "pending" });
    mockGetApproval.mockResolvedValue({ id: "approval-2", status: "rejected", decision: "Not needed" });

    const resultPromise = executeWithTierCheck(
      mockBlock,
      { db: mockDb, autonomyTierService: service },
      mockContext,
    );

    await vi.runAllTimersAsync();
    const result = await resultPromise as { error: string };

    expect(result.error).toContain("rejected");
    expect(mockResolveApproval).not.toHaveBeenCalled(); // not auto-denied, was manually rejected

    vi.useRealTimers();
  });

  it("yellow-tier: auto-denies on timeout", async () => {
    vi.useFakeTimers();

    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "yellow", timeoutMs: 3000 },
    ]);
    const service = new AutonomyTierService(mockDb);
    await service.load();

    mockCreateApproval.mockResolvedValue({ id: "approval-3", taskId: null, status: "pending" });
    // Always return pending (simulating no one approving)
    mockGetApproval.mockResolvedValue({ id: "approval-3", status: "pending", decision: null });

    const resultPromise = executeWithTierCheck(
      mockBlock,
      { db: mockDb, autonomyTierService: service },
      mockContext,
    );

    // Advance time past the timeout
    await vi.runAllTimersAsync();
    const result = await resultPromise as { error: string };

    expect(result.error).toContain("timed out");
    expect(mockResolveApproval).toHaveBeenCalledWith(
      mockDb,
      "approval-3",
      "rejected",
      expect.stringContaining("Auto-denied"),
    );

    vi.useRealTimers();
  });
});
