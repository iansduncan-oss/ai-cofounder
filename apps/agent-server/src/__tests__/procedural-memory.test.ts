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

vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class { complete = vi.fn(); },
}));

const { ProceduralMemoryService } = await import("../services/procedural-memory.js");

describe("ProceduralMemoryService", () => {
  let service: InstanceType<typeof ProceduralMemoryService>;
  const mockComplete = vi.fn();
  const mockEmbed = vi.fn().mockResolvedValue(new Array(768).fill(0));

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProceduralMemoryService({} as never, { complete: mockComplete } as never, mockEmbed);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        triggerPattern: "Deploy a Node.js app",
        steps: [{ description: "Build", agent: "coder" }, { description: "Deploy", agent: "orchestrator" }],
        preconditions: ["Tests passing"],
        tags: ["deployment", "nodejs"],
      }) }],
    });
  });

  it("learns procedure from completed goal", async () => {
    mockDb.getGoal.mockResolvedValueOnce({ id: "g-1", title: "Deploy app", status: "completed", description: "Deploy to prod" });
    mockDb.listTasksByGoal.mockResolvedValueOnce([
      { id: "t-1", title: "Build", status: "completed", assignedAgent: "coder", output: "Built" },
      { id: "t-2", title: "Deploy", status: "completed", assignedAgent: "orchestrator", output: "Deployed" },
    ]);
    mockDb.createProceduralMemory.mockResolvedValueOnce({ id: "pm-1", triggerPattern: "Deploy" });

    const result = await service.learnProcedure("g-1");
    expect(result).toBeTruthy();
    expect(mockDb.createProceduralMemory).toHaveBeenCalledTimes(1);
  });

  it("skips non-completed goals", async () => {
    mockDb.getGoal.mockResolvedValueOnce({ id: "g-1", status: "active" });
    const result = await service.learnProcedure("g-1");
    expect(result).toBeNull();
  });

  it("skips goals with too few tasks", async () => {
    mockDb.getGoal.mockResolvedValueOnce({ id: "g-1", status: "completed" });
    mockDb.listTasksByGoal.mockResolvedValueOnce([{ id: "t-1", status: "completed" }]);
    const result = await service.learnProcedure("g-1");
    expect(result).toBeNull();
  });

  it("finds matching procedures by vector search", async () => {
    mockDb.searchProceduralMemoriesByVector.mockResolvedValueOnce([
      { id: "pm-1", trigger_pattern: "Deploy app", steps: [{ d: "build" }], success_count: 5, failure_count: 1, distance: 0.2 },
    ]);
    const results = await service.findMatchingProcedures("deploy nodejs");
    expect(results.length).toBe(1);
    expect(results[0].successCount).toBe(5);
  });

  it("records success and failure", async () => {
    await service.recordSuccess("pm-1");
    expect(mockDb.incrementProceduralSuccess).toHaveBeenCalledWith(expect.anything(), "pm-1");
    await service.recordFailure("pm-1");
    expect(mockDb.incrementProceduralFailure).toHaveBeenCalledWith(expect.anything(), "pm-1");
  });
});
