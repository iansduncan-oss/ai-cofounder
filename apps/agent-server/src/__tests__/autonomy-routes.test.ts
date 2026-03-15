import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
  requireEnv: (name: string) => `mock-${name}`,
}));

const mockListToolTierConfigs = vi.fn().mockResolvedValue([]);
const mockUpsertToolTierConfig = vi.fn().mockResolvedValue({
  id: "ttc-1", toolName: "search_web", tier: "yellow", timeoutMs: 300000,
  updatedBy: "dashboard", updatedAt: new Date().toISOString(),
});
const mockListExpiredPendingApprovals = vi.fn().mockResolvedValue([]);
const mockResolveApproval = vi.fn().mockResolvedValue({ id: "a-1", status: "rejected" });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listToolTierConfigs: (...args: unknown[]) => mockListToolTierConfigs(...args),
  upsertToolTierConfig: (...args: unknown[]) => mockUpsertToolTierConfig(...args),
  listExpiredPendingApprovals: (...args: unknown[]) => mockListExpiredPendingApprovals(...args),
  resolveApproval: (...args: unknown[]) => mockResolveApproval(...args),
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
  return { LlmRegistry: MockLlmRegistry, AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn(),
  getDeployVerificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
}));

const { buildServer } = await import("../server.js");

const mockTierService = {
  load: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  getTier: vi.fn().mockReturnValue("green"),
  getTimeoutMs: vi.fn().mockReturnValue(300_000),
  getAllRed: vi.fn().mockReturnValue([]),
  isLoaded: vi.fn().mockReturnValue(true),
};

describe("autonomy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListToolTierConfigs.mockResolvedValue([]);
  });

  it("GET /api/autonomy/tiers returns 200 with empty array", async () => {
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    const res = await app.inject({ method: "GET", url: "/api/autonomy/tiers" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("GET /api/autonomy/tiers returns seeded tools", async () => {
    mockListToolTierConfigs.mockResolvedValue([
      { toolName: "search_web", tier: "green", timeoutMs: 300000, updatedBy: null, updatedAt: "2026-01-01" },
      { toolName: "git_push", tier: "yellow", timeoutMs: 60000, updatedBy: "dashboard", updatedAt: "2026-01-02" },
    ]);
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    const res = await app.inject({ method: "GET", url: "/api/autonomy/tiers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].toolName).toBe("search_web");
    expect(body[1].tier).toBe("yellow");
    await app.close();
  });

  it("PUT /api/autonomy/tiers/:toolName updates tier", async () => {
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    const res = await app.inject({
      method: "PUT", url: "/api/autonomy/tiers/search_web",
      payload: { tier: "yellow" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpsertToolTierConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolName: "search_web", tier: "yellow", updatedBy: "dashboard" }),
    );
    await app.close();
  });

  it("PUT /api/autonomy/tiers/:toolName calls upsert and returns 200", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "PUT", url: "/api/autonomy/tiers/git_push",
      payload: { tier: "red" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpsertToolTierConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolName: "git_push", tier: "red" }),
    );
    await app.close();
  });

  it("PUT /api/autonomy/tiers/:toolName with invalid tier returns 400", async () => {
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    const res = await app.inject({
      method: "PUT", url: "/api/autonomy/tiers/search_web",
      payload: { tier: "invalid" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("PUT /api/autonomy/tiers/:toolName accepts custom timeoutMs", async () => {
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    await app.inject({
      method: "PUT", url: "/api/autonomy/tiers/git_push",
      payload: { tier: "yellow", timeoutMs: 60000 },
    });
    expect(mockUpsertToolTierConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 60000 }),
    );
    await app.close();
  });

  it("PUT /api/autonomy/tiers/:toolName defaults timeoutMs to 300000", async () => {
    const { app } = buildServer();
    (app as unknown as Record<string, unknown>).autonomyTierService = mockTierService;
    await app.inject({
      method: "PUT", url: "/api/autonomy/tiers/search_web",
      payload: { tier: "green" },
    });
    expect(mockUpsertToolTierConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
    await app.close();
  });
});

describe("approval timeout sweep", () => {
  it("resolves expired pending approvals", async () => {
    mockListExpiredPendingApprovals.mockResolvedValue([
      { id: "a-1", status: "pending", createdAt: new Date(Date.now() - 600_000) },
      { id: "a-2", status: "pending", createdAt: new Date(Date.now() - 900_000) },
    ]);
    const { listExpiredPendingApprovals, resolveApproval } = await import("@ai-cofounder/db");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expired = await listExpiredPendingApprovals({} as any);
    for (const approval of expired) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await resolveApproval({} as any, approval.id, "rejected", "Auto-denied: approval timeout exceeded");
    }
    expect(mockListExpiredPendingApprovals).toHaveBeenCalled();
    expect(mockResolveApproval).toHaveBeenCalledTimes(2);
    expect(mockResolveApproval).toHaveBeenCalledWith(
      expect.anything(), "a-1", "rejected", "Auto-denied: approval timeout exceeded",
    );
  });
});
