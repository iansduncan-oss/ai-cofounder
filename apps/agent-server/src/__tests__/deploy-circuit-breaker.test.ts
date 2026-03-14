import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const dbMocks = mockDbModule();
vi.mock("@ai-cofounder/db", () => dbMocks);

const mockSendBriefing = vi.fn().mockResolvedValue(undefined);
const mockNotificationService = { sendBriefing: mockSendBriefing } as any;

const { DeployCircuitBreakerService } = await import("../services/deploy-circuit-breaker.js");

describe("DeployCircuitBreakerService", () => {
  let service: InstanceType<typeof DeployCircuitBreakerService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DeployCircuitBreakerService({} as any, mockNotificationService);
  });

  it("records a failure and increments count", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce(null);
    await service.recordFailure("abc1234567");
    expect(dbMocks.upsertDeployCircuitBreaker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureCount: 1, isPaused: false }),
    );
  });

  it("pauses after threshold failures", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: false,
      failureCount: 2,
      failureWindowStart: new Date(),
    });
    await service.recordFailure("abc1234567");
    expect(dbMocks.upsertDeployCircuitBreaker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isPaused: true, failureCount: 3 }),
    );
    expect(mockSendBriefing).toHaveBeenCalledWith(expect.stringContaining("Circuit Breaker Activated"));
  });

  it("does not double-pause if already paused", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: true,
      failureCount: 5,
      failureWindowStart: new Date(),
      pausedReason: "already paused",
    });
    await service.recordFailure("def5678");
    expect(mockSendBriefing).not.toHaveBeenCalled();
  });

  it("resets window when it expires", async () => {
    const oldWindow = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5h ago
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: false,
      failureCount: 2,
      failureWindowStart: oldWindow,
    });
    await service.recordFailure("abc123");
    expect(dbMocks.upsertDeployCircuitBreaker).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureCount: 1 }),
    );
  });

  it("isDeployPaused returns true when paused", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: true,
      failureWindowStart: new Date(),
    });
    expect(await service.isDeployPaused()).toBe(true);
  });

  it("isDeployPaused auto-resumes on expired window", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: true,
      failureWindowStart: new Date(Date.now() - 5 * 60 * 60 * 1000),
    });
    expect(await service.isDeployPaused()).toBe(false);
    expect(dbMocks.resetCircuitBreaker).toHaveBeenCalledWith(expect.anything(), "auto-expired");
  });

  it("resume resets the circuit breaker", async () => {
    await service.resume("admin");
    expect(dbMocks.resetCircuitBreaker).toHaveBeenCalledWith(expect.anything(), "admin");
    expect(mockSendBriefing).toHaveBeenCalledWith(expect.stringContaining("Resumed"));
  });

  it("getStatus returns default when no state", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce(null);
    const status = await service.getStatus();
    expect(status.isPaused).toBe(false);
    expect(status.failureCount).toBe(0);
  });

  it("getStatus reflects paused state", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: true,
      pausedAt: new Date(),
      pausedReason: "3 failures",
      failureCount: 3,
      failureWindowStart: new Date(),
      resumedAt: null,
      resumedBy: null,
    });
    const status = await service.getStatus();
    expect(status.isPaused).toBe(true);
    expect(status.failureCount).toBe(3);
  });

  it("notification includes commit SHA", async () => {
    dbMocks.getDeployCircuitBreaker.mockResolvedValueOnce({
      isPaused: false,
      failureCount: 2,
      failureWindowStart: new Date(),
    });
    await service.recordFailure("abcdef1234567890", "container crash");
    expect(mockSendBriefing).toHaveBeenCalledWith(expect.stringContaining("abcdef1"));
  });
});
