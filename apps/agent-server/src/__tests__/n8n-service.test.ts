import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  process.env.N8N_SHARED_SECRET = "test-secret";
  process.env.N8N_WEBHOOK_TIMEOUT_MS = "5000";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (name: string, defaultValue: string) => process.env[name] ?? defaultValue,
}));

const { createN8nService } = await import("../services/n8n.js");

describe("n8n service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("triggers a workflow successfully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, executionId: "exec-1" }),
    });

    const service = createN8nService();
    const result = await service.trigger(
      "http://localhost:5678/webhook/test",
      "send-email",
      { to: "user@example.com", subject: "Hello" },
    );

    expect(result.success).toBe(true);
    expect(result.workflowName).toBe("send-email");
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual({ success: true, executionId: "exec-1" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:5678/webhook/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-n8n-secret": "test-secret",
        }),
      }),
    );
  });

  it("returns error on HTTP failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal Server Error" }),
    });

    const service = createN8nService();
    const result = await service.trigger(
      "http://localhost:5678/webhook/broken",
      "broken-workflow",
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("HTTP 500");
    expect(result.statusCode).toBe(500);
  });

  it("returns error on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const service = createN8nService();
    const result = await service.trigger(
      "http://localhost:5678/webhook/unreachable",
      "unreachable",
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  it("handles non-JSON responses gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not JSON")),
      text: () => Promise.resolve("OK"),
    });

    const service = createN8nService();
    const result = await service.trigger(
      "http://localhost:5678/webhook/text",
      "text-workflow",
      {},
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe("OK");
  });
});

describe("n8n service listExecutions", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.N8N_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.N8N_API_KEY;
  });

  it("returns executions from n8n REST API on success", async () => {
    process.env.N8N_API_KEY = "test-api-key";

    const executions = [
      {
        id: "exec-1",
        workflowId: "wf-1",
        status: "success",
        finished: true,
        mode: "webhook",
        startedAt: "2024-01-01T00:00:00Z",
        stoppedAt: "2024-01-01T00:00:01Z",
        retryOf: null,
        retrySuccessId: null,
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: executions }),
    });

    const service = createN8nService();
    const result = await service.listExecutions({ workflowId: "wf-1", limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("exec-1");
    expect(result[0].status).toBe("success");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/executions"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-N8N-API-KEY": "test-api-key" }),
      }),
    );
  });

  it("returns empty array when N8N_API_KEY is not configured", async () => {
    // N8N_API_KEY not set (deleted in beforeEach)
    const service = createN8nService();
    const result = await service.listExecutions();

    expect(result).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    process.env.N8N_API_KEY = "test-api-key";

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const service = createN8nService();
    const result = await service.listExecutions();

    expect(result).toEqual([]);
  });
});
