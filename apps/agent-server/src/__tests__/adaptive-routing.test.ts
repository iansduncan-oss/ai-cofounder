import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockGetAgentPerformanceStats = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getAgentPerformanceStats: (...args: unknown[]) => mockGetAgentPerformanceStats(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const { AdaptiveRoutingService } = await import("../services/adaptive-routing.js");

 
const fakeDb = {} as any;

describe("AdaptiveRoutingService", () => {
  let service: InstanceType<typeof AdaptiveRoutingService>;

  beforeEach(() => {
    service = new AdaptiveRoutingService(fakeDb);
    mockGetAgentPerformanceStats.mockReset();
  });

  describe("suggestAgent", () => {
    it("returns original assignment with confidence 0 when no data", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([]);

      const result = await service.suggestAgent("Fix the login bug", "coder");

      expect(result.recommended).toBe("coder");
      expect(result.confidence).toBe(0);
      expect(result.stats).toEqual([]);
    });

    it("returns original assignment when current agent has insufficient data", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "coder", totalTasks: 5, completedTasks: 4, failedTasks: 1, avgDurationMs: 5000, overallSuccessRate: 0.8, recentSuccessRate: null, recentCompletedTasks: 0, recentFailedTasks: 0 },
        { agent: "researcher", totalTasks: 20, completedTasks: 18, failedTasks: 2, avgDurationMs: 3000, overallSuccessRate: 0.9, recentSuccessRate: 0.95, recentCompletedTasks: 8, recentFailedTasks: 0 },
      ]);

      const result = await service.suggestAgent("Fix the login bug", "coder");

      expect(result.recommended).toBe("coder");
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain("Insufficient data");
    });

    it("recommends higher-scoring agent when confidence is sufficient", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "coder", totalTasks: 30, completedTasks: 15, failedTasks: 15, avgDurationMs: 10000, overallSuccessRate: 0.5, recentSuccessRate: 0.4, recentCompletedTasks: 4, recentFailedTasks: 6 },
        { agent: "researcher", totalTasks: 30, completedTasks: 27, failedTasks: 3, avgDurationMs: 3000, overallSuccessRate: 0.9, recentSuccessRate: 0.95, recentCompletedTasks: 19, recentFailedTasks: 1 },
      ]);

      const result = await service.suggestAgent("Research the API docs", "coder");

      expect(result.recommended).toBe("researcher");
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.stats).toHaveLength(2);
    });

    it("keeps current assignment when it is the best agent", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "coder", totalTasks: 30, completedTasks: 27, failedTasks: 3, avgDurationMs: 3000, overallSuccessRate: 0.9, recentSuccessRate: 0.95, recentCompletedTasks: 19, recentFailedTasks: 1 },
        { agent: "researcher", totalTasks: 30, completedTasks: 15, failedTasks: 15, avgDurationMs: 10000, overallSuccessRate: 0.5, recentSuccessRate: 0.4, recentCompletedTasks: 4, recentFailedTasks: 6 },
      ]);

      const result = await service.suggestAgent("Fix the login bug", "coder");

      expect(result.recommended).toBe("coder");
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toContain("already the best");
    });

    it("filters out non-dispatchable roles like orchestrator", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "orchestrator", totalTasks: 100, completedTasks: 95, failedTasks: 5, avgDurationMs: 1000, overallSuccessRate: 0.95, recentSuccessRate: 0.98, recentCompletedTasks: 49, recentFailedTasks: 1 },
        { agent: "coder", totalTasks: 30, completedTasks: 15, failedTasks: 15, avgDurationMs: 5000, overallSuccessRate: 0.5, recentSuccessRate: 0.5, recentCompletedTasks: 5, recentFailedTasks: 5 },
      ]);

      const result = await service.suggestAgent("Build feature", "coder");

      // Orchestrator should not appear in stats
      expect(result.stats.find((s: { agent: string }) => s.agent === "orchestrator")).toBeUndefined();
    });

    it("speed component rewards faster agents", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "coder", totalTasks: 30, completedTasks: 24, failedTasks: 6, avgDurationMs: 10000, overallSuccessRate: 0.8, recentSuccessRate: 0.8, recentCompletedTasks: 8, recentFailedTasks: 2 },
        { agent: "researcher", totalTasks: 30, completedTasks: 24, failedTasks: 6, avgDurationMs: 2000, overallSuccessRate: 0.8, recentSuccessRate: 0.8, recentCompletedTasks: 8, recentFailedTasks: 2 },
      ]);

      const result = await service.suggestAgent("Do something", "coder");

      // Same success rate, but researcher is 5x faster — should score higher
      const coderStats = result.stats.find((s: { agent: string }) => s.agent === "coder");
      const researcherStats = result.stats.find((s: { agent: string }) => s.agent === "researcher");
      expect(researcherStats.score).toBeGreaterThan(coderStats.score);
    });
  });

  describe("recordDecision", () => {
    it("stores decisions in ring buffer", () => {
      service.recordDecision({
        taskId: "t1", originalAgent: "coder", recommendedAgent: "researcher",
        confidence: 0.8, overridden: true, timestamp: new Date(),
      });
      service.recordDecision({
        taskId: "t2", originalAgent: "coder", recommendedAgent: "coder",
        confidence: 0, overridden: false, timestamp: new Date(),
      });

      // Access via getRoutingStats
      mockGetAgentPerformanceStats.mockResolvedValue([]);
      return service.getRoutingStats().then((stats: Awaited<ReturnType<typeof service.getRoutingStats>>) => {
        expect(stats.totalDecisions).toBe(2);
        expect(stats.totalOverrides).toBe(1);
        expect(stats.overrideRate).toBe(0.5);
        expect(stats.recentDecisions).toHaveLength(2);
        // Most recent first
        expect(stats.recentDecisions[0].taskId).toBe("t2");
      });
    });

    it("evicts oldest entries after 100", async () => {
      for (let i = 0; i < 105; i++) {
        service.recordDecision({
          taskId: `t${i}`, originalAgent: "coder", recommendedAgent: "researcher",
          confidence: 0.8, overridden: true, timestamp: new Date(),
        });
      }

      mockGetAgentPerformanceStats.mockResolvedValue([]);
      const stats = await service.getRoutingStats();
      expect(stats.totalDecisions).toBe(100);
      // Oldest 5 should have been evicted
      expect(stats.recentDecisions[stats.recentDecisions.length - 1].taskId).toBe("t5");
    });
  });

  describe("getRoutingStats", () => {
    it("returns empty stats when no data", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([]);

      const stats = await service.getRoutingStats();

      expect(stats.agentPerformance).toEqual([]);
      expect(stats.recentDecisions).toEqual([]);
      expect(stats.overrideRate).toBe(0);
      expect(stats.totalDecisions).toBe(0);
    });

    it("returns scored agent performance sorted by score", async () => {
      mockGetAgentPerformanceStats.mockResolvedValue([
        { agent: "coder", totalTasks: 30, completedTasks: 15, failedTasks: 15, avgDurationMs: 5000, overallSuccessRate: 0.5, recentSuccessRate: 0.5, recentCompletedTasks: 5, recentFailedTasks: 5 },
        { agent: "researcher", totalTasks: 30, completedTasks: 27, failedTasks: 3, avgDurationMs: 3000, overallSuccessRate: 0.9, recentSuccessRate: 0.9, recentCompletedTasks: 9, recentFailedTasks: 1 },
      ]);

      const stats = await service.getRoutingStats();

      expect(stats.agentPerformance).toHaveLength(2);
      // Researcher should be first (higher score)
      expect(stats.agentPerformance[0].agent).toBe("researcher");
      expect(stats.agentPerformance[0].score).toBeGreaterThan(stats.agentPerformance[1].score);
      expect(stats.agentPerformance[0].hasSufficientData).toBe(true);
    });
  });
});
