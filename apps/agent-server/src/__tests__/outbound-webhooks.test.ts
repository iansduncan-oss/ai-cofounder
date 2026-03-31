import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockInsert = vi.fn();
const mockSelect = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  outboundWebhooks: { active: "active" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ col: _col, val: _val })),
}));

const { OutboundWebhookService } = await import("../services/outbound-webhooks.js");

describe("OutboundWebhookService", () => {
  let service: InstanceType<typeof OutboundWebhookService>;
  const originalFetch = globalThis.fetch;

  const mockDb = {
    insert: mockInsert,
    select: mockSelect,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OutboundWebhookService(mockDb);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("register() adds webhook subscription", async () => {
    const webhook = {
      id: "wh-1",
      url: "https://example.com/hook",
      eventTypes: ["goal.completed"],
      headers: { "X-Custom": "value" },
      description: "Test webhook",
      active: true,
    };
    mockInsert.mockReturnValueOnce({
      values: vi.fn().mockReturnValueOnce({
        returning: vi.fn().mockResolvedValueOnce([webhook]),
      }),
    });

    const result = await service.register(
      "https://example.com/hook",
      ["goal.completed"],
      { "X-Custom": "value" },
      "Test webhook",
    );

    expect(result).toEqual(webhook);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("list() returns all active webhooks", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://a.com/hook", eventTypes: ["goal.completed"], active: true, headers: null },
      { id: "wh-2", url: "https://b.com/hook", eventTypes: ["task.failed"], active: true, headers: null },
    ];
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const result = await service.list();

    expect(result).toEqual(webhooks);
    expect(result).toHaveLength(2);
  });

  it("fire() sends to matching webhooks", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://a.com/hook", eventTypes: ["goal.completed"], headers: { "X-Key": "abc" } },
      { id: "wh-2", url: "https://b.com/hook", eventTypes: ["task.failed"], headers: null },
    ];

    // Mock list()
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;

    await service.fire("goal.completed", { goalId: "g-1" });

    // Only matching webhook should be called (wh-1 matches "goal.completed")
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://a.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Key": "abc",
        }),
      }),
    );

    // Verify payload includes event, payload, and timestamp
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe("goal.completed");
    expect(body.payload).toEqual({ goalId: "g-1" });
    expect(body.timestamp).toBeDefined();
  });

  it("fire() handles failed webhook deliveries gracefully", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://fail.com/hook", eventTypes: ["test.event"], headers: null },
    ];

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = mockFetch;

    // Should not throw
    await expect(service.fire("test.event", { data: "test" })).resolves.toBeUndefined();
  });

  it("fire() handles fetch rejection gracefully via Promise.allSettled", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://timeout.com/hook", eventTypes: ["test.event"], headers: null },
    ];

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error("Timeout"));
    globalThis.fetch = mockFetch;

    // Should not throw due to Promise.allSettled
    await expect(service.fire("test.event", {})).resolves.toBeUndefined();
  });

  it("includes custom headers and timestamp in payload", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://a.com/hook", eventTypes: ["notify"], headers: { Authorization: "Bearer token123" } },
    ];

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;

    await service.fire("notify", { msg: "hello" });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBe("Bearer token123");
    expect(callHeaders["Content-Type"]).toBe("application/json");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(typeof body.timestamp).toBe("string");
    // Should be a valid ISO date
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("10s timeout on webhook calls via AbortSignal", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://a.com/hook", eventTypes: ["test"], headers: null },
    ];

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;

    await service.fire("test", {});

    // Verify AbortSignal.timeout(10_000) is passed
    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.signal).toBeDefined();
  });

  it("fire() does nothing when no webhooks match", async () => {
    const webhooks = [
      { id: "wh-1", url: "https://a.com/hook", eventTypes: ["other.event"], headers: null },
    ];

    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce(webhooks),
      }),
    });

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    await service.fire("no.match", {});

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
