import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @ai-cofounder/shared before any imports
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock @ai-cofounder/queue — only used inside triggerHealSession (dynamic import)
const mockEnqueueAutonomousSession = vi.fn().mockResolvedValue("job-1");
vi.mock("@ai-cofounder/queue", () => ({
  enqueueAutonomousSession: (...args: unknown[]) => mockEnqueueAutonomousSession(...args),
}));

// Import after mocks are set up
import { CiSelfHealService, type CiHealState } from "../services/ci-self-heal.js";

// ── Mock Redis ──
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue("OK");
const mockRedisDel = vi.fn().mockResolvedValue(1);

const mockRedis = {
  get: mockRedisGet,
  set: mockRedisSet,
  del: mockRedisDel,
};

// ── Mock NotificationService ──
const mockSendBriefing = vi.fn().mockResolvedValue(undefined);
const mockNotificationService = {
  sendBriefing: mockSendBriefing,
};

function makeService(): CiSelfHealService {
  return new CiSelfHealService(
    mockRedis as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    mockNotificationService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  );
}

describe("CiSelfHealService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing state in Redis
    mockRedisGet.mockResolvedValue(null);
  });

  // ── recordFailure ──

  it("recordFailure increments count on first failure", async () => {
    const svc = makeService();
    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/1");

    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    const [key, value] = mockRedisSet.mock.calls[0] as [string, string, ...unknown[]];
    expect(key).toBe("ci-heal:owner/repo:main");
    const state = JSON.parse(value) as CiHealState;
    expect(state.count).toBe(1);
    expect(state.healAttempted).toBe(false);
    expect(state.lastWorkflowUrl).toBe("https://github.com/actions/runs/1");
    expect(state.firstFailedAt).toBeDefined();
  });

  it("recordFailure does NOT trigger heal on first failure", async () => {
    const svc = makeService();
    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/1");

    // Only 1 redis.set call (no second write for healAttempted=true)
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    expect(mockEnqueueAutonomousSession).not.toHaveBeenCalled();
    expect(mockSendBriefing).not.toHaveBeenCalled();
  });

  it("recordFailure triggers heal after 2nd consecutive failure", async () => {
    const svc = makeService();

    // Simulate existing count=1 state in Redis
    const existingState: CiHealState = {
      count: 1,
      firstFailedAt: "2026-03-10T10:00:00Z",
      healAttempted: false,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/2");

    // enqueueAutonomousSession should be called with ci-heal trigger
    expect(mockEnqueueAutonomousSession).toHaveBeenCalledTimes(1);
    expect(mockEnqueueAutonomousSession).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "ci-heal" }),
    );
  });

  it("recordFailure sets healAttempted=true after triggering", async () => {
    const svc = makeService();

    const existingState: CiHealState = {
      count: 1,
      firstFailedAt: "2026-03-10T10:00:00Z",
      healAttempted: false,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/2");

    // Second redis.set call should have healAttempted=true
    expect(mockRedisSet).toHaveBeenCalledTimes(2);
    const [, secondValue] = mockRedisSet.mock.calls[1] as [string, string, ...unknown[]];
    const updatedState = JSON.parse(secondValue) as CiHealState;
    expect(updatedState.healAttempted).toBe(true);
    expect(updatedState.count).toBe(2);
  });

  it("recordFailure does NOT double-trigger when healAttempted is true", async () => {
    const svc = makeService();

    // Already attempted heal — count is now 3 but healAttempted=true
    const existingState: CiHealState = {
      count: 3,
      firstFailedAt: "2026-03-10T10:00:00Z",
      healAttempted: true,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/4");

    // No heal should be triggered again
    expect(mockEnqueueAutonomousSession).not.toHaveBeenCalled();
    expect(mockSendBriefing).not.toHaveBeenCalled();
    // But count is still incremented
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    const [, value] = mockRedisSet.mock.calls[0] as [string, string, ...unknown[]];
    const state = JSON.parse(value) as CiHealState;
    expect(state.count).toBe(4);
  });

  it("recordFailure skips autonomous/ branches", async () => {
    const svc = makeService();
    await svc.recordFailure("owner/repo", "autonomous/fix-123", "https://github.com/actions/runs/1");

    // Redis should not be accessed at all
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockEnqueueAutonomousSession).not.toHaveBeenCalled();
  });

  it("recordFailure skips dependabot/ branches", async () => {
    const svc = makeService();
    await svc.recordFailure("owner/repo", "dependabot/npm_and_yarn/lodash-4.17.21", "https://github.com/actions/runs/1");

    // Redis should not be accessed at all
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockEnqueueAutonomousSession).not.toHaveBeenCalled();
  });

  // ── recordSuccess ──

  it("recordSuccess deletes the Redis key", async () => {
    const svc = makeService();
    await svc.recordSuccess("owner/repo", "main");

    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith("ci-heal:owner/repo:main");
  });

  // ── getState ──

  it("getState returns parsed state from Redis", async () => {
    const svc = makeService();
    const existingState: CiHealState = {
      count: 2,
      firstFailedAt: "2026-03-10T10:00:00Z",
      lastFailedAt: "2026-03-10T10:30:00Z",
      lastWorkflowUrl: "https://github.com/actions/runs/2",
      healAttempted: true,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    const result = await svc.getState("owner/repo", "main");

    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.healAttempted).toBe(true);
    expect(result!.lastWorkflowUrl).toBe("https://github.com/actions/runs/2");
  });

  it("getState returns null when no key exists", async () => {
    const svc = makeService();
    mockRedisGet.mockResolvedValue(null);

    const result = await svc.getState("owner/repo", "feature/new-thing");

    expect(result).toBeNull();
  });

  // ── triggerHealSession side-effects ──

  it("triggerHealSession sends notification with failure details", async () => {
    const svc = makeService();

    const existingState: CiHealState = {
      count: 1,
      firstFailedAt: "2026-03-10T10:00:00Z",
      healAttempted: false,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    await svc.recordFailure("owner/repo", "main", "https://github.com/actions/runs/2");

    expect(mockSendBriefing).toHaveBeenCalledTimes(1);
    const [message] = mockSendBriefing.mock.calls[0] as [string];
    expect(message).toContain("owner/repo");
    expect(message).toContain("main");
    expect(message).toContain("2"); // consecutive failure count
  });

  it("triggerHealSession enqueues session with prompt containing repo and branch", async () => {
    const svc = makeService();

    const existingState: CiHealState = {
      count: 1,
      firstFailedAt: "2026-03-10T10:00:00Z",
      healAttempted: false,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(existingState));

    await svc.recordFailure("owner/myrepo", "main", "https://github.com/actions/runs/2");

    expect(mockEnqueueAutonomousSession).toHaveBeenCalledTimes(1);
    const [job] = mockEnqueueAutonomousSession.mock.calls[0] as [{ trigger: string; prompt: string }];
    expect(job.trigger).toBe("ci-heal");
    expect(job.prompt).toContain("owner/myrepo");
    expect(job.prompt).toContain("main");
    expect(job.prompt).toContain("request_approval");
  });
});
