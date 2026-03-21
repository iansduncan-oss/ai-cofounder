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

const { FailurePatternService } = await import("../services/failure-patterns.js");

describe("FailurePatternService", () => {
  let service: InstanceType<typeof FailurePatternService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FailurePatternService({} as never);
  });

  it("records a failure with auto-categorization", async () => {
    await service.recordFailure("git_push", "Connection timeout after 30s");
    expect(mockDb.upsertFailurePattern).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      toolName: "git_push",
      errorCategory: "timeout",
    }));
  });

  it("categorizes rate limit errors", async () => {
    await service.recordFailure("search_web", "429 Too Many Requests");
    expect(mockDb.upsertFailurePattern.mock.calls[0][1].errorCategory).toBe("rate_limit");
  });

  it("categorizes permission errors", async () => {
    await service.recordFailure("write_file", "403 Forbidden");
    expect(mockDb.upsertFailurePattern.mock.calls[0][1].errorCategory).toBe("permission");
  });

  it("finds patterns for a tool", async () => {
    mockDb.getFailurePatternsForTool.mockResolvedValueOnce([
      { errorCategory: "timeout", errorMessage: "timed out", resolution: "Retry with backoff", frequency: 5 },
    ]);
    const patterns = await service.findPatterns("git_push");
    expect(patterns.length).toBe(1);
    expect(patterns[0].frequency).toBe(5);
  });

  it("formats patterns for prompt", async () => {
    mockDb.listFailurePatterns.mockResolvedValueOnce([
      { toolName: "git_push", errorCategory: "timeout", errorMessage: "Connection timed out", resolution: "Retry", frequency: 3 },
    ]);
    const prompt = await service.formatPatternsForPrompt();
    expect(prompt).toContain("Known issues");
    expect(prompt).toContain("git_push");
  });

  it("returns empty prompt when no patterns", async () => {
    mockDb.listFailurePatterns.mockResolvedValueOnce([]);
    const prompt = await service.formatPatternsForPrompt();
    expect(prompt).toBe("");
  });

  it("records resolution for pattern", async () => {
    await service.recordResolution("git_push", "timeout", "Use SSH instead of HTTPS");
    expect(mockDb.upsertFailurePattern).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      resolution: "Use SSH instead of HTTPS",
    }));
  });
});
