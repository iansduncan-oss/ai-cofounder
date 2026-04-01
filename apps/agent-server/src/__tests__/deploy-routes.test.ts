import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.BRIEFING_HOUR = "25";
});

const mockCreateDeployment = vi.fn();
const mockUpdateDeploymentStatus = vi.fn();
const mockGetLatestDeployment = vi.fn();
const mockListDeployments = vi.fn();
const mockGetDeploymentBySha = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDeployment: (...args: unknown[]) => mockCreateDeployment(...args),
  updateDeploymentStatus: (...args: unknown[]) => mockUpdateDeploymentStatus(...args),
  getLatestDeployment: (...args: unknown[]) => mockGetLatestDeployment(...args),
  listDeployments: (...args: unknown[]) => mockListDeployments(...args),
  getDeploymentBySha: (...args: unknown[]) => mockGetDeploymentBySha(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock" }],
    model: "test", stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 }, provider: "test",
  });
  class MockLlmRegistry {
    complete = mockComplete; completeDirect = mockComplete;
    register = vi.fn(); getProvider = vi.fn(); resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry, AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {},
    OllamaProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn(),
  getDeployVerificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
}));

const { buildServer } = await import("../server.js");

beforeEach(() => { vi.clearAllMocks(); });

describe("Deploy routes", () => {
  describe("POST /api/deploys/webhook", () => {
    it("creates deployment on deploy_started", async () => {
      mockCreateDeployment.mockResolvedValueOnce({ id: "dep-1", status: "started" });
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST", url: "/api/deploys/webhook",
        payload: { event: "deploy_started", commitSha: "abc1234567890", shortSha: "abc1234", branch: "main", services: ["agent-server"] },
      });
      await app.close();
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe("dep-1");
      expect(mockCreateDeployment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ commitSha: "abc1234567890", shortSha: "abc1234" }));
    });

    it("updates status on deploy_completed", async () => {
      mockGetDeploymentBySha.mockResolvedValueOnce({ id: "dep-1" });
      mockUpdateDeploymentStatus.mockResolvedValueOnce({ id: "dep-1", status: "verifying" });
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST", url: "/api/deploys/webhook",
        payload: { event: "deploy_completed", commitSha: "abc1234567890" },
      });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(expect.anything(), "dep-1", expect.objectContaining({ status: "verifying" }));
    });

    it("marks failed on deploy_failed", async () => {
      mockGetDeploymentBySha.mockResolvedValueOnce({ id: "dep-1" });
      mockUpdateDeploymentStatus.mockResolvedValueOnce({ id: "dep-1", status: "failed" });
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST", url: "/api/deploys/webhook",
        payload: { event: "deploy_failed", commitSha: "abc1234567890", error: "Health check failed" },
      });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(mockUpdateDeploymentStatus).toHaveBeenCalledWith(expect.anything(), "dep-1", expect.objectContaining({ status: "failed", errorLog: "Health check failed" }));
    });

    it("returns 404 when deploy_completed for unknown sha", async () => {
      mockGetDeploymentBySha.mockResolvedValueOnce(null);
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST", url: "/api/deploys/webhook",
        payload: { event: "deploy_completed", commitSha: "unknown123" },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/deploys", () => {
    it("lists deployments", async () => {
      mockListDeployments.mockResolvedValueOnce({ data: [{ id: "dep-1", shortSha: "abc1234", status: "healthy" }], total: 1 });
      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/deploys" });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });
  });

  describe("GET /api/deploys/latest", () => {
    it("returns latest deployment", async () => {
      mockGetLatestDeployment.mockResolvedValueOnce({ id: "dep-1", shortSha: "abc1234", status: "healthy" });
      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/deploys/latest" });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe("dep-1");
    });

    it("returns null when no deployments", async () => {
      mockGetLatestDeployment.mockResolvedValueOnce(null);
      const { app } = buildServer();
      const res = await app.inject({ method: "GET", url: "/api/deploys/latest" });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeNull();
    });
  });
});
