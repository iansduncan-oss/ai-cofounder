import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: vi.fn(),
}));

import { optionalEnv } from "@ai-cofounder/shared";
const mockOptionalEnv = vi.mocked(optionalEnv);

import { NotificationService, createNotificationService } from "../services/notifications.js";

describe("NotificationService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const approval = {
    approvalId: "a1",
    taskId: "t1-uuid-1234",
    reason: "Deploy to production",
    requestedBy: "orchestrator",
  };

  describe("construction", () => {
    it("isConfigured returns false when no config provided", () => {
      const service = new NotificationService({});
      expect(service.isConfigured()).toBe(false);
    });

    it("isConfigured returns true with Slack config", () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      expect(service.isConfigured()).toBe(true);
    });

    it("isConfigured returns true with Discord config", () => {
      const service = new NotificationService({
        discordWebhookUrl: "https://discord.com/api/webhooks/test",
      });
      expect(service.isConfigured()).toBe(true);
    });

    it("isConfigured returns true with both configs", () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
        discordWebhookUrl: "https://discord.com/api/webhooks/test",
      });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe("createNotificationService", () => {
    it("reads env vars and creates service", () => {
      mockOptionalEnv.mockImplementation((name: string, def: string) => {
        if (name === "SLACK_BOT_TOKEN") return "xoxb-test";
        if (name === "SLACK_NOTIFICATION_CHANNEL") return "C12345";
        if (name === "DISCORD_NOTIFICATION_WEBHOOK_URL") return "https://discord.com/api/webhooks/test";
        return def;
      });

      const service = createNotificationService();
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe("notifyApprovalCreated", () => {
    it("no-ops when not configured", async () => {
      const service = new NotificationService({});
      await service.notifyApprovalCreated(approval);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("posts to Slack when configured", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      await service.notifyApprovalCreated(approval);

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

    it("posts to Discord when configured", async () => {
      const webhookUrl = "https://discord.com/api/webhooks/test/token";
      const service = new NotificationService({ discordWebhookUrl: webhookUrl });
      await service.notifyApprovalCreated(approval);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.embeds[0].title).toContain("approval is required");
      expect(body.embeds[0].color).toBe(0xfee75c);
    });

    it("sends to both Slack and Discord when both configured", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
        discordWebhookUrl: "https://discord.com/api/webhooks/test/token",
      });
      await service.notifyApprovalCreated(approval);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("handles fetch failure gracefully", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error"),
      );
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      // Should not throw
      await service.notifyApprovalCreated(approval);
    });

    it("handles Slack API error response gracefully", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: "channel_not_found" }),
      });
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      // Should not throw
      await service.notifyApprovalCreated(approval);
    });
  });

  describe("notifyGoalCompleted", () => {
    const goalCompleted = {
      goalId: "g-1234-5678",
      goalTitle: "Build user auth",
      status: "completed",
      completedTasks: 3,
      totalTasks: 3,
      tasks: [
        { title: "Research", agent: "researcher", status: "completed" },
        { title: "Code", agent: "coder", status: "completed" },
        { title: "Review", agent: "reviewer", status: "completed" },
      ],
      durationMs: 125000,
    };

    it("no-ops when not configured", async () => {
      const service = new NotificationService({});
      await service.notifyGoalCompleted(goalCompleted);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sends success notification to Slack", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      await service.notifyGoalCompleted(goalCompleted);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.text).toContain("Objective Complete");
      expect(body.blocks[0].text.text).toContain("Objective Complete");
      expect(body.blocks[1].text.text).toContain("3/3 tasks completed");
      expect(body.blocks[1].text.text).toContain("2m 5s");
    });

    it("sends failure notification to Discord", async () => {
      const webhookUrl = "https://discord.com/api/webhooks/test/token";
      const service = new NotificationService({ discordWebhookUrl: webhookUrl });
      await service.notifyGoalCompleted({
        ...goalCompleted,
        status: "failed",
        completedTasks: 1,
      });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.embeds[0].title).toContain("Objective Failed");
      expect(body.embeds[0].color).toBe(0xed4245);
      expect(body.embeds[0].description).toContain("1/3 tasks completed");
    });

    it("handles missing durationMs", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      await service.notifyGoalCompleted({ ...goalCompleted, durationMs: undefined });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.blocks[1].text.text).not.toContain("in ");
    });
  });

  describe("notifyTaskFailed", () => {
    const taskFailed = {
      goalId: "g-1234-5678",
      goalTitle: "Build user auth",
      taskId: "t-abcd-efgh",
      taskTitle: "Generate login component",
      agent: "coder",
      error: "LLM timeout after 30s",
    };

    it("no-ops when not configured", async () => {
      const service = new NotificationService({});
      await service.notifyTaskFailed(taskFailed);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sends to Slack with error details", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      await service.notifyTaskFailed(taskFailed);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.text).toContain("Task Failed");
      expect(body.blocks[1].text.text).toContain("Generate login component");
      expect(body.blocks[1].text.text).toContain("coder");
      expect(body.blocks[1].text.text).toContain("LLM timeout after 30s");
    });

    it("sends to Discord with orange color", async () => {
      const webhookUrl = "https://discord.com/api/webhooks/test/token";
      const service = new NotificationService({ discordWebhookUrl: webhookUrl });
      await service.notifyTaskFailed(taskFailed);

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.embeds[0].title).toContain("Task failed");
      expect(body.embeds[0].color).toBe(0xe67e22);
      expect(body.embeds[0].description).toContain("coder");
    });
  });

  describe("notifyGoalProgress", () => {
    it("no-ops when not configured", async () => {
      const service = new NotificationService({});
      await service.notifyGoalProgress({
        goalId: "g-1",
        goalTitle: "Test",
        taskTitle: "Step 1",
        agent: "researcher",
        completedTasks: 0,
        totalTasks: 3,
        status: "started",
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sends progress to Slack", async () => {
      const service = new NotificationService({
        slackToken: "xoxb-test",
        slackChannel: "C12345",
      });
      await service.notifyGoalProgress({
        goalId: "g-1234-5678",
        goalTitle: "Build it",
        taskTitle: "Research phase",
        agent: "researcher",
        completedTasks: 1,
        totalTasks: 3,
        status: "completed",
      });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.text).toContain("Research phase");
      expect(body.text).toContain("1/3");
    });

    it("sends progress to Discord", async () => {
      const webhookUrl = "https://discord.com/api/webhooks/test/token";
      const service = new NotificationService({ discordWebhookUrl: webhookUrl });
      await service.notifyGoalProgress({
        goalId: "g-1",
        goalTitle: "Build it",
        taskTitle: "Code step",
        agent: "coder",
        completedTasks: 2,
        totalTasks: 3,
        status: "completed",
      });

      const body = JSON.parse(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.embeds[0].color).toBe(0x57f287); // green for completed
    });
  });

  describe("backwards compatibility", () => {
    it("notifyApprovalCreated standalone function works", async () => {
      mockOptionalEnv.mockImplementation((name: string, def: string) => {
        if (name === "SLACK_BOT_TOKEN") return "xoxb-test";
        if (name === "SLACK_NOTIFICATION_CHANNEL") return "C12345";
        return def;
      });

      const { notifyApprovalCreated } = await import("../services/notifications.js");
      await notifyApprovalCreated(approval);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
