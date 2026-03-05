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
