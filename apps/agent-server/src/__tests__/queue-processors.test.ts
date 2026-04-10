import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (name: string, def: string) => process.env[name] ?? def,
}));

const { notifyCiFailures, fireN8nActionWebhook } = await import("../helpers/queue-processors.js");
import type { GitHubCIStatus } from "../services/monitoring.js";
import type { TriageResult } from "../services/discord-triage.js";
import type { DiscordTriageMessage } from "@ai-cofounder/queue";

function ciStatus(overrides: Partial<GitHubCIStatus> = {}): GitHubCIStatus {
  return {
    repo: "owner/repo",
    branch: "main",
    status: "failure",
    conclusion: "failure",
    url: "https://github.com/owner/repo/actions/runs/1",
    updatedAt: "2026-04-09T00:00:00Z",
    ...overrides,
  };
}

describe("notifyCiFailures", () => {
  const notifySystemInsights = vi.fn().mockResolvedValue(undefined);
  const notificationService = { notifySystemInsights };

  beforeEach(() => {
    notifySystemInsights.mockClear();
  });

  it("no-ops when no failures present", async () => {
    const count = await notifyCiFailures(notificationService, [
      ciStatus({ status: "success", conclusion: "success" }),
    ]);
    expect(count).toBe(0);
    expect(notifySystemInsights).not.toHaveBeenCalled();
  });

  it("no-ops when result list is empty", async () => {
    const count = await notifyCiFailures(notificationService, []);
    expect(count).toBe(0);
    expect(notifySystemInsights).not.toHaveBeenCalled();
  });

  it("notifies with formatted failure lines for each failing run", async () => {
    const results = [
      ciStatus({ repo: "alice/api", branch: "main", conclusion: "failure", url: "https://gh/1" }),
      ciStatus({ repo: "alice/web", branch: "feat/x", conclusion: "timed_out", url: "https://gh/2" }),
      ciStatus({ status: "success", conclusion: "success" }),
    ];
    const count = await notifyCiFailures(notificationService, results);

    expect(count).toBe(2);
    expect(notifySystemInsights).toHaveBeenCalledTimes(1);
    const [insights] = notifySystemInsights.mock.calls[0];
    expect(insights).toHaveLength(1);
    expect(insights[0]).toContain("CI failure(s) detected:");
    expect(insights[0]).toContain("**alice/api** (main): failure — https://gh/1");
    expect(insights[0]).toContain("**alice/web** (feat/x): timed_out — https://gh/2");
    expect(insights[0]).not.toContain("success");
  });

  it("falls back to 'failed' label when conclusion is null", async () => {
    await notifyCiFailures(notificationService, [
      ciStatus({ conclusion: null, url: "https://gh/3" }),
    ]);
    const [insights] = notifySystemInsights.mock.calls[0];
    expect(insights[0]).toContain(": failed — https://gh/3");
  });
});

describe("fireN8nActionWebhook", () => {
  const originalFetch = globalThis.fetch;
  const originalWebhooks = process.env.N8N_ACTION_WEBHOOKS;

  function triageResult(overrides: Partial<TriageResult> = {}): TriageResult {
    return {
      actionable: true,
      category: "bug_report",
      confidence: 0.9,
      summary: "Login broken on Safari",
      urgency: "high",
      relevantMessageIds: ["m-1"],
      suggestedAction: "Investigate auth middleware",
      ...overrides,
    };
  }

  function message(overrides: Partial<DiscordTriageMessage> = {}): DiscordTriageMessage {
    return {
      messageId: "m-1",
      channelId: "c-1",
      channelName: "bugs",
      authorId: "a-1",
      authorName: "alice",
      content: "cannot log in",
      timestamp: "2026-04-09T00:00:00Z",
      hasAttachments: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWebhooks === undefined) delete process.env.N8N_ACTION_WEBHOOKS;
    else process.env.N8N_ACTION_WEBHOOKS = originalWebhooks;
  });

  it("no-ops when N8N_ACTION_WEBHOOKS is unset", async () => {
    delete process.env.N8N_ACTION_WEBHOOKS;
    const fired = await fireN8nActionWebhook({
      result: triageResult(),
      messages: [message()],
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });
    expect(fired).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("no-ops when category is not in the mapping", async () => {
    process.env.N8N_ACTION_WEBHOOKS = JSON.stringify({
      feature_request: "https://n8n/webhook/features",
    });
    const fired = await fireN8nActionWebhook({
      result: triageResult({ category: "bug_report" }),
      messages: [message()],
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });
    expect(fired).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fires POST with full payload when category is mapped", async () => {
    process.env.N8N_ACTION_WEBHOOKS = JSON.stringify({
      bug_report: "https://n8n/webhook/bugs",
    });
    const result = triageResult();
    const msgs = [
      message({ messageId: "m-1", authorName: "alice", content: "cannot log in" }),
      message({ messageId: "m-2", authorName: "bob", content: "ignore this noise" }),
    ];

    const fired = await fireN8nActionWebhook({
      result,
      messages: msgs,
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });

    expect(fired).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://n8n/webhook/bugs");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      category: "bug_report",
      summary: "Login broken on Safari",
      suggestedAction: "Investigate auth middleware",
      urgency: "high",
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });
    // Only relevant messages (m-1) should be included, not m-2
    expect(body.messages).toBe("alice: cannot log in");
  });

  it("returns false and does not throw on fetch failure", async () => {
    process.env.N8N_ACTION_WEBHOOKS = JSON.stringify({
      bug_report: "https://n8n/webhook/bugs",
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const fired = await fireN8nActionWebhook({
      result: triageResult(),
      messages: [message()],
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });

    expect(fired).toBe(false);
    // No rejection leaks out
  });

  it("returns false when the env var contains invalid JSON", async () => {
    process.env.N8N_ACTION_WEBHOOKS = "{not json";
    const fired = await fireN8nActionWebhook({
      result: triageResult(),
      messages: [message()],
      channelName: "bugs",
      batchedAt: "2026-04-09T00:00:00Z",
    });
    expect(fired).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
