import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: vi.fn(),
}));

import { optionalEnv } from "@ai-cofounder/shared";
const mockOptionalEnv = vi.mocked(optionalEnv);

describe("notifyApprovalCreated", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function loadModule() {
    // Re-import to pick up fresh env mock values
    const mod = await import("../services/notifications.js");
    return mod.notifyApprovalCreated;
  }

  const approval = {
    approvalId: "a1",
    taskId: "t1-uuid-1234",
    reason: "Deploy to production",
    requestedBy: "orchestrator",
  };

  it("no-ops when SLACK_BOT_TOKEN is not set", async () => {
    mockOptionalEnv.mockReturnValue("");
    const notifyApprovalCreated = await loadModule();

    await notifyApprovalCreated(approval);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when SLACK_NOTIFICATION_CHANNEL is not set", async () => {
    mockOptionalEnv.mockImplementation((name: string, def: string) =>
      name === "SLACK_BOT_TOKEN" ? "xoxb-test" : def,
    );
    const notifyApprovalCreated = await loadModule();

    await notifyApprovalCreated(approval);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("posts to Slack when configured", async () => {
    mockOptionalEnv.mockImplementation((name: string, def: string) => {
      if (name === "SLACK_BOT_TOKEN") return "xoxb-test";
      if (name === "SLACK_NOTIFICATION_CHANNEL") return "C12345";
      return def;
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const notifyApprovalCreated = await loadModule();
    await notifyApprovalCreated(approval);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-test",
        }),
      }),
    );

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.channel).toBe("C12345");
    expect(body.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "header" }),
        expect.objectContaining({
          type: "actions",
          elements: expect.arrayContaining([
            expect.objectContaining({ action_id: "approval_approve", value: "a1" }),
            expect.objectContaining({ action_id: "approval_reject", value: "a1" }),
          ]),
        }),
      ]),
    );
  });

  it("handles fetch failure gracefully", async () => {
    mockOptionalEnv.mockImplementation((name: string, def: string) => {
      if (name === "SLACK_BOT_TOKEN") return "xoxb-test";
      if (name === "SLACK_NOTIFICATION_CHANNEL") return "C12345";
      return def;
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const notifyApprovalCreated = await loadModule();
    // Should not throw
    await notifyApprovalCreated(approval);
  });

  it("handles Slack API error response gracefully", async () => {
    mockOptionalEnv.mockImplementation((name: string, def: string) => {
      if (name === "SLACK_BOT_TOKEN") return "xoxb-test";
      if (name === "SLACK_NOTIFICATION_CHANNEL") return "C12345";
      return def;
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "channel_not_found" }),
    });

    const notifyApprovalCreated = await loadModule();
    // Should not throw
    await notifyApprovalCreated(approval);
  });
});
