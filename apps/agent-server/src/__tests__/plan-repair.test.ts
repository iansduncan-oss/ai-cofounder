import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTestEnv } from "@ai-cofounder/test-utils";

setupTestEnv();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_n: string, d: string) => d,
}));

vi.mock("@ai-cofounder/db", () => ({}));
vi.mock("@ai-cofounder/llm", () => ({ LlmRegistry: class { complete = vi.fn(); } }));

const { PlanRepairService } = await import("../services/plan-repair.js");

describe("PlanRepairService", () => {
  let service: InstanceType<typeof PlanRepairService>;
  const mockComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PlanRepairService({ complete: mockComplete } as never, 2);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        correctiveTasks: [
          { title: "Fix the config", description: "Update config file", assignedAgent: "coder" },
          { title: "Retry deployment", description: "Re-run deploy", assignedAgent: "orchestrator" },
        ],
      }) }],
    });
  });

  it("generates corrective tasks from LLM", async () => {
    const result = await service.generateCorrectivePlan(
      { id: "t-1", title: "Deploy", status: "failed", error: "Connection refused" },
      [{ id: "t-0", title: "Build", status: "completed", output: "Built" }],
      [{ id: "t-2", title: "Verify", status: "pending" }],
      "Deploy the application",
    );
    expect(result).toBeTruthy();
    expect(result!.length).toBe(2);
    expect(result![0].title).toBe("Fix the config");
  });

  it("returns null on LLM failure", async () => {
    mockComplete.mockRejectedValueOnce(new Error("LLM down"));
    const result = await service.generateCorrectivePlan(
      { id: "t-1", title: "Deploy", status: "failed", error: "err" },
      [], [], "Deploy",
    );
    expect(result).toBeNull();
  });

  it("returns null when LLM returns empty corrections", async () => {
    mockComplete.mockResolvedValueOnce({ content: [{ type: "text", text: '{"correctiveTasks": []}' }] });
    const result = await service.generateCorrectivePlan(
      { id: "t-1", title: "Deploy", status: "failed", error: "err" },
      [], [], "Deploy",
    );
    expect(result).toBeNull();
  });

  it("tracks replan count per goal", () => {
    expect(service.canReplan("g-1")).toBe(true);
    service.recordReplan("g-1");
    expect(service.getReplanCount("g-1")).toBe(1);
    service.recordReplan("g-1");
    expect(service.canReplan("g-1")).toBe(false);
  });

  it("clears goal tracking", () => {
    service.recordReplan("g-1");
    service.clearGoal("g-1");
    expect(service.getReplanCount("g-1")).toBe(0);
    expect(service.canReplan("g-1")).toBe(true);
  });

  it("limits corrective tasks to 3", async () => {
    mockComplete.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({
        correctiveTasks: [
          { title: "A", description: "a", assignedAgent: "coder" },
          { title: "B", description: "b", assignedAgent: "coder" },
          { title: "C", description: "c", assignedAgent: "coder" },
          { title: "D", description: "d", assignedAgent: "coder" },
          { title: "E", description: "e", assignedAgent: "coder" },
        ],
      }) }],
    });
    const result = await service.generateCorrectivePlan(
      { id: "t-1", title: "X", status: "failed", error: "err" },
      [], [], "Goal",
    );
    expect(result!.length).toBeLessThanOrEqual(3);
  });
});
