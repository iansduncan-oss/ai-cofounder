import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { ComplexityEstimator } = await import("../services/complexity-estimator.js");

describe("ComplexityEstimator", () => {
  const estimator = new ComplexityEstimator();

  it("rates simple tasks as low complexity", () => {
    const result = estimator.estimate({ description: "Say hello" });
    expect(result.level).toBe("low");
    expect(result.roundBudget).toBe(3);
    expect(result.thinkingTokenBudget).toBe(0);
    expect(result.score).toBeLessThanOrEqual(0.25);
  });

  it("rates complex tasks higher", () => {
    const result = estimator.estimate({
      description: "Refactor the authentication system to use distributed security tokens with encryption and comprehensive integration testing across the entire architecture",
      taskCount: 8,
      toolCount: 12,
      goalPriority: "critical",
    });
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.roundBudget).toBeGreaterThanOrEqual(8);
    expect(result.thinkingTokenBudget).toBeGreaterThan(0);
  });

  it("prior failures increase complexity", () => {
    const base = estimator.estimate({ description: "Fix a bug" });
    const withFailures = estimator.estimate({
      description: "Fix a bug",
      priorFailureRate: 0.8,
    });
    expect(withFailures.score).toBeGreaterThan(base.score);
  });

  it("high priority increases complexity", () => {
    const low = estimator.estimate({ description: "Update docs", goalPriority: "low" });
    const critical = estimator.estimate({ description: "Update docs", goalPriority: "critical" });
    expect(critical.score).toBeGreaterThan(low.score);
  });

  it("more tools increase complexity", () => {
    const few = estimator.estimate({ description: "Do something", toolCount: 2 });
    const many = estimator.estimate({ description: "Do something", toolCount: 15 });
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("score is always between 0 and 1", () => {
    const min = estimator.estimate({ description: "" });
    const max = estimator.estimate({
      description: "a".repeat(5000),
      taskCount: 100,
      toolCount: 100,
      priorFailureRate: 1,
      goalPriority: "critical",
    });
    expect(min.score).toBeGreaterThanOrEqual(0);
    expect(max.score).toBeLessThanOrEqual(1);
  });

  it("returns expected factor keys", () => {
    const result = estimator.estimate({ description: "Test task" });
    expect(result.factors).toHaveProperty("descriptionLength");
    expect(result.factors).toHaveProperty("keywords");
    expect(result.factors).toHaveProperty("taskCount");
    expect(result.factors).toHaveProperty("toolCount");
    expect(result.factors).toHaveProperty("priorFailures");
    expect(result.factors).toHaveProperty("priority");
  });
});
