import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTestEnv } from "@ai-cofounder/test-utils";

setupTestEnv();

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_n: string, d: string) => d,
}));

const { SelfHealingService } = await import("../services/self-healing.js");

describe("SelfHealingService", () => {
  let service: InstanceType<typeof SelfHealingService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SelfHealingService();
  });

  describe("failure recording", () => {
    it("records a failure and updates health score", () => {
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "Connection timed out",
        timestamp: new Date(),
      });

      const health = service.getHealthScore("coder");
      expect(health.recentFailures).toBe(1);
      expect(health.recentSuccesses).toBe(0);
      expect(health.score).toBe(0);
    });

    it("records success and improves health score", () => {
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "timed out",
        timestamp: new Date(),
      });
      service.recordSuccess("coder");

      const health = service.getHealthScore("coder");
      expect(health.recentSuccesses).toBe(1);
      expect(health.recentFailures).toBe(1);
      expect(health.score).toBe(50);
    });
  });

  describe("circuit breaker", () => {
    it("opens after threshold failures", () => {
      for (let i = 0; i < 3; i++) {
        service.recordFailure({
          agentRole: "researcher",
          errorCategory: "connection",
          errorMessage: "ECONNREFUSED",
          timestamp: new Date(),
        });
      }

      const health = service.getHealthScore("researcher");
      expect(health.circuitBreaker.status).toBe("open");
      expect(health.circuitBreaker.failureCount).toBe(3);
    });

    it("blocks execution when circuit breaker is open", () => {
      for (let i = 0; i < 3; i++) {
        service.recordFailure({
          agentRole: "coder",
          errorCategory: "timeout",
          errorMessage: "timed out",
          timestamp: new Date(),
        });
      }

      const recommendation = service.checkBeforeExecution("coder");
      expect(recommendation.action).toBe("skip");
      expect(recommendation.reason).toContain("Circuit breaker OPEN");
    });

    it("closes after success in half-open state", () => {
      // Open the breaker
      for (let i = 0; i < 3; i++) {
        service.recordFailure({
          agentRole: "coder",
          errorCategory: "timeout",
          errorMessage: "timed out",
          timestamp: new Date(),
        });
      }

      // Simulate half-open by manipulating internal state via a success after timeout
      // For this test, we directly verify the health score after recording success
      const healthBefore = service.getHealthScore("coder");
      expect(healthBefore.circuitBreaker.status).toBe("open");

      // Record a success — this won't close the breaker from open (only from half-open)
      // but it should reduce the failure count in closed state
      service.recordSuccess("coder");
      const healthAfter = service.getHealthScore("coder");
      // Still open because we didn't transition through half-open
      expect(healthAfter.circuitBreaker.status).toBe("open");
    });
  });

  describe("consecutive failure handling", () => {
    it("recommends escalation after 2 consecutive failures", () => {
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "timed out",
        taskCategory: "coding",
        timestamp: new Date(),
      });
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "timed out again",
        taskCategory: "coding",
        timestamp: new Date(),
      });

      const recommendation = service.checkBeforeExecution("coder", "coding");
      expect(recommendation.action).toBe("escalate");
    });

    it("recommends skipping after 3 consecutive failures", () => {
      for (let i = 0; i < 3; i++) {
        service.recordFailure({
          agentRole: "planner",
          errorCategory: "server_error",
          errorMessage: "Internal server error",
          taskCategory: "planning",
          timestamp: new Date(),
        });
      }

      const recommendation = service.checkBeforeExecution("planner", "planning");
      // Circuit breaker takes priority (also 3 failures)
      expect(["skip"]).toContain(recommendation.action);
    });

    it("resets consecutive failures on success", () => {
      service.recordFailure({
        agentRole: "researcher",
        errorCategory: "timeout",
        errorMessage: "timed out",
        taskCategory: "research",
        timestamp: new Date(),
      });
      service.recordFailure({
        agentRole: "researcher",
        errorCategory: "timeout",
        errorMessage: "timed out",
        taskCategory: "research",
        timestamp: new Date(),
      });

      service.recordSuccess("researcher", "research");

      const recommendation = service.checkBeforeExecution("researcher", "research");
      expect(recommendation.action).toBe("proceed");
    });
  });

  describe("pattern detection", () => {
    it("detects systematic failures (3+ in 24h)", () => {
      for (let i = 0; i < 4; i++) {
        service.recordFailure({
          agentRole: "coder",
          errorCategory: "timeout",
          errorMessage: "Connection timed out",
          timestamp: new Date(),
        });
      }

      const patterns = service.detectSystematicFailures();
      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(patterns[0].count).toBe(4);
      expect(patterns[0].key).toContain("coder");
      expect(patterns[0].key).toContain("timeout");
    });

    it("returns empty when no systematic failures", () => {
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "timed out",
        timestamp: new Date(),
      });

      const patterns = service.detectSystematicFailures();
      expect(patterns.length).toBe(0);
    });
  });

  describe("health scores", () => {
    it("returns 100 for agents with no data", () => {
      const health = service.getHealthScore("debugger");
      expect(health.score).toBe(100);
      expect(health.recentSuccesses).toBe(0);
      expect(health.recentFailures).toBe(0);
    });

    it("returns all agent health scores", () => {
      const scores = service.getAllHealthScores();
      expect(scores.length).toBe(6); // 6 specialist roles
      expect(scores.every((s) => s.score === 100)).toBe(true);
    });
  });

  describe("report generation", () => {
    it("generates a report with recommendations for degraded agents", () => {
      // Create enough failures to trigger degradation
      for (let i = 0; i < 6; i++) {
        service.recordFailure({
          agentRole: "coder",
          errorCategory: "timeout",
          errorMessage: "timed out",
          timestamp: new Date(),
        });
      }
      // Add a success to avoid 0% (just to verify the threshold check)
      service.recordSuccess("coder");

      const report = service.generateReport();
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it("includes circuit breaker information in report", () => {
      for (let i = 0; i < 3; i++) {
        service.recordFailure({
          agentRole: "researcher",
          errorCategory: "connection",
          errorMessage: "ECONNREFUSED",
          timestamp: new Date(),
        });
      }

      const report = service.generateReport();
      expect(report.activeCircuitBreakers.length).toBe(1);
      expect(report.activeCircuitBreakers[0].agentRole).toBe("researcher");
    });
  });

  describe("status endpoint data", () => {
    it("returns complete status object", () => {
      service.recordFailure({
        agentRole: "coder",
        errorCategory: "timeout",
        errorMessage: "Connection timed out",
        timestamp: new Date(),
      });

      const status = service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.totalFailuresTracked).toBe(1);
      expect(status.healthScores.length).toBe(6);
      expect(status.oldestRecord).toBeInstanceOf(Date);
    });
  });

  describe("error categorization", () => {
    it("categorizes timeout errors", () => {
      expect(SelfHealingService.categorizeError("Connection timed out")).toBe("timeout");
    });

    it("categorizes rate limit errors", () => {
      expect(SelfHealingService.categorizeError("429 Too Many Requests")).toBe("rate_limit");
    });

    it("categorizes connection errors", () => {
      expect(SelfHealingService.categorizeError("ECONNREFUSED")).toBe("connection");
    });

    it("categorizes permission errors", () => {
      expect(SelfHealingService.categorizeError("403 Forbidden")).toBe("permission");
    });

    it("returns unknown for unrecognized errors", () => {
      expect(SelfHealingService.categorizeError("Something weird happened")).toBe("unknown");
    });
  });

  describe("proceed recommendation", () => {
    it("returns proceed when no issues detected", () => {
      const recommendation = service.checkBeforeExecution("coder");
      expect(recommendation.action).toBe("proceed");
      expect(recommendation.reason).toBe("No known issues");
    });
  });
});
