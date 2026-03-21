import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockGetToolStats = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => ({
  getToolStats: (...args: unknown[]) => mockGetToolStats(...args),
}));

describe("ToolEfficacyService", () => {
  let ToolEfficacyService: typeof import("../services/tool-efficacy.js").ToolEfficacyService;

  beforeEach(async () => {
    const mod = await import("../services/tool-efficacy.js");
    ToolEfficacyService = mod.ToolEfficacyService;
    mockGetToolStats.mockClear();
  });

  it("should return null when no tools have issues", async () => {
    mockGetToolStats.mockResolvedValueOnce([
      { toolName: "read_file", totalExecutions: 100, successCount: 99, errorCount: 0, avgDurationMs: 200, p95DurationMs: 200, maxDurationMs: 200 },
    ]);
    const service = new ToolEfficacyService({} as never);
    const hints = await service.getEfficacyHints();
    expect(hints).toBeNull();
  });

  it("should flag tools with low success rate", async () => {
    mockGetToolStats.mockResolvedValueOnce([
      { toolName: "search_web", totalExecutions: 50, successCount: 30, errorCount: 0, avgDurationMs: 2000, p95DurationMs: 2000, maxDurationMs: 2000 },
    ]);
    const service = new ToolEfficacyService({} as never);
    const hints = await service.getEfficacyHints();
    expect(hints).toContain("search_web");
    expect(hints).toContain("60% success rate");
  });

  it("should flag tools with high latency", async () => {
    mockGetToolStats.mockResolvedValueOnce([
      { toolName: "browse_web", totalExecutions: 20, successCount: 20, errorCount: 0, avgDurationMs: 15000, p95DurationMs: 15000, maxDurationMs: 15000 },
    ]);
    const service = new ToolEfficacyService({} as never);
    const hints = await service.getEfficacyHints();
    expect(hints).toContain("browse_web");
    expect(hints).toContain("15.0s avg latency");
  });

  it("should cache hints for 5 minutes", async () => {
    mockGetToolStats.mockResolvedValue([
      { toolName: "slow_tool", totalExecutions: 10, successCount: 5, errorCount: 0, avgDurationMs: 12000, p95DurationMs: 12000, maxDurationMs: 12000 },
    ]);
    const service = new ToolEfficacyService({} as never);

    await service.getEfficacyHints();
    await service.getEfficacyHints();

    // Only called once due to caching
    expect(mockGetToolStats).toHaveBeenCalledTimes(1);
  });
});
