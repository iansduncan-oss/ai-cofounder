import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockUpdateDeploymentStatus = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  updateDeploymentStatus: (...args: unknown[]) => mockUpdateDeploymentStatus(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, defaultValue: string) => {
    if (name === "DEPLOY_HEALTH_URL") return "http://localhost:99999/health";
    if (name === "VPS_HOST") return "";
    return defaultValue;
  },
}));

const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Root cause: service crashed on startup due to missing env var." }],
  model: "test", stop_reason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 20 }, provider: "test",
});

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete; completeDirect = mockComplete;
    register = vi.fn(); getProvider = vi.fn(); resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry };
});

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => vi.fn().mockRejectedValue(new Error("SSH not available in test")),
}));

const { DeployHealthService } = await import("../services/deploy-health.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

const mockDb = {} as any;
const mockNotificationService = { sendBriefing: vi.fn().mockResolvedValue(undefined) } as any;
const mockMonitoringService = {
  checkVPSHealth: vi.fn().mockResolvedValue({
    containers: [
      { name: "agent-server", status: "Up 5m", health: "healthy" },
      { name: "discord-bot", status: "Up 5m", health: "healthy" },
    ],
  }),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateDeploymentStatus.mockResolvedValue({});
  mockNotificationService.sendBriefing.mockResolvedValue(undefined);
});

describe("DeployHealthService", () => {
  describe("analyzeRootCause", () => {
    it("returns LLM analysis", async () => {
      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      const result = await service.analyzeRootCause("abc1234", "Health check failed", "Error: ECONNREFUSED");
      expect(result).toContain("Root cause");
      expect(mockComplete).toHaveBeenCalled();
    });

    it("returns fallback on LLM error", async () => {
      mockComplete.mockRejectedValueOnce(new Error("LLM down"));
      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      const result = await service.analyzeRootCause("abc1234", "Health check failed", "logs");
      expect(result).toContain("Health check failed");
    });
  });

  describe("verifyDeployment", () => {
    it("marks deployment healthy when all checks pass", async () => {
      // Mock fetch for health check
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService, mockMonitoringService);
      await service.verifyDeployment("dep-1", "abc1234567890");

      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(), "dep-1",
        expect.objectContaining({ status: "healthy" }),
      );
      expect(mockNotificationService.sendBriefing).toHaveBeenCalledWith(
        expect.stringContaining("verified healthy"),
      );
      globalThis.fetch = origFetch;
    });

    it("triggers failure handling when health check fails", async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      await service.verifyDeployment("dep-1", "abc1234567890");

      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(), "dep-1",
        expect.objectContaining({ status: "failed" }),
      );
      globalThis.fetch = origFetch;
    });

    it("triggers failure handling when fetch throws", async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      await service.verifyDeployment("dep-1", "abc1234567890");

      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(), "dep-1",
        expect.objectContaining({ status: "failed" }),
      );
      globalThis.fetch = origFetch;
    });
  });

  describe("handleDeployFailure", () => {
    it("records failure with root cause analysis", async () => {
      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      await service.handleDeployFailure("dep-1", "abc1234567890", undefined, [
        { service: "agent-server", status: "unhealthy", error: "HTTP 503" },
      ]);

      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(), "dep-1",
        expect.objectContaining({
          status: "failed",
          rootCauseAnalysis: expect.stringContaining("Root cause"),
        }),
      );
      expect(mockNotificationService.sendBriefing).toHaveBeenCalled();
    });

    it("attempts rollback when previousSha provided but VPS not configured", async () => {
      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      await service.handleDeployFailure("dep-1", "abc1234567890", "prev123", []);

      // Rollback will fail (VPS_HOST empty), so status stays failed
      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(
        expect.anything(), "dep-1",
        expect.objectContaining({ status: "failed", rolledBack: false }),
      );
    });
  });

  describe("fetchContainerLogs", () => {
    it("returns error message when VPS_HOST not configured", async () => {
      const service = new DeployHealthService(mockDb, new LlmRegistry(), mockNotificationService);
      const logs = await service.fetchContainerLogs();
      expect(logs).toContain("VPS_HOST not configured");
    });
  });
});
