import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { GoalScope } from "@ai-cofounder/shared";

const logger = createLogger("notifications");

interface ApprovalNotification {
  approvalId: string;
  taskId: string;
  reason: string;
  requestedBy: string;
}

interface GoalCompletedNotification {
  goalId: string;
  goalTitle: string;
  status: string;
  completedTasks: number;
  totalTasks: number;
  tasks: Array<{ title: string; agent: string; status: string }>;
  durationMs?: number;
}

interface TaskFailedNotification {
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskTitle: string;
  agent: string;
  error: string;
}

interface GoalProgressNotification {
  goalId: string;
  goalTitle: string;
  taskTitle: string;
  agent: string;
  completedTasks: number;
  totalTasks: number;
  status: "started" | "completed" | "failed";
}

interface GoalProposedNotification {
  goalId: string;
  goalTitle: string;
  scope: GoalScope;
  taskCount: number;
}

interface NotificationConfig {
  slackToken?: string;
  slackChannel?: string;
  slackDmUserId?: string;
  discordWebhookUrl?: string;
}

export class NotificationService {
  private slackToken: string;
  private slackChannel: string;
  private slackDmUserId: string;
  private discordWebhookUrl: string;

  constructor(config: NotificationConfig) {
    this.slackToken = config.slackToken ?? "";
    this.slackChannel = config.slackChannel ?? "";
    this.slackDmUserId = config.slackDmUserId ?? "";
    this.discordWebhookUrl = config.discordWebhookUrl ?? "";
  }

  isConfigured(): boolean {
    return this.hasSlack() || this.hasDiscord();
  }

  private hasSlack(): boolean {
    return !!(this.slackToken && this.slackChannel);
  }

  private hasDiscord(): boolean {
    return !!this.discordWebhookUrl;
  }

  /** Posts approval notification to Slack with Approve/Reject buttons + Discord embed */
  async notifyApprovalCreated(approval: ApprovalNotification): Promise<void> {
    const slackPromise = this.hasSlack()
      ? this.sendSlack(
          this.slackChannel,
          `Approval requested: ${approval.reason}`,
          [
            {
              type: "header",
              text: { type: "plain_text", text: "A Matter Requiring Your Approval, Sir" },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${approval.reason}*\nRequested by: \`${approval.requestedBy}\` · Task: \`${approval.taskId.slice(0, 8)}…\``,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Approve" },
                  style: "primary",
                  action_id: "approval_approve",
                  value: approval.approvalId,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "Reject" },
                  style: "danger",
                  action_id: "approval_reject",
                  value: approval.approvalId,
                },
              ],
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `ID: \`${approval.approvalId}\` · Or use \`/approve ${approval.approvalId}\``,
                },
              ],
            },
          ],
        )
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: `Sir, your approval is required: ${approval.reason}`,
            description: `Requested by: ${approval.requestedBy}\nTask: \`${approval.taskId.slice(0, 8)}…\``,
            color: 0xfee75c, // yellow
            footer: { text: `ID: ${approval.approvalId}` },
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify that a goal completed or failed */
  async notifyGoalCompleted(notification: GoalCompletedNotification): Promise<void> {
    const isSuccess = notification.status === "completed";
    const emoji = isSuccess ? "\u2705" : "\u274c";
    const title = isSuccess ? "Objective Complete, Sir" : "Objective Failed, Sir";
    const color = isSuccess ? 0x57f287 : 0xed4245; // green or red

    const durationText = notification.durationMs
      ? formatDuration(notification.durationMs)
      : undefined;

    const summary = `${notification.completedTasks}/${notification.totalTasks} tasks completed${durationText ? ` in ${durationText}` : ""}`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(
          this.slackChannel,
          `${emoji} ${title}: ${notification.goalTitle}`,
          [
            {
              type: "header",
              text: { type: "plain_text", text: `${emoji} ${title}` },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${notification.goalTitle}*\n${summary}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Goal: \`${notification.goalId.slice(0, 8)}…\` · ${new Date().toISOString()}`,
                },
              ],
            },
          ],
        )
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: `${title}: ${notification.goalTitle}`,
            description: summary,
            color,
            footer: { text: `Goal: ${notification.goalId.slice(0, 8)}…` },
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify that a task failed during goal execution */
  async notifyTaskFailed(notification: TaskFailedNotification): Promise<void> {
    const errorTruncated = notification.error.slice(0, 500);

    const slackPromise = this.hasSlack()
      ? this.sendSlack(
          this.slackChannel,
          `\u274c Task Failed: ${notification.taskTitle}`,
          [
            {
              type: "header",
              text: { type: "plain_text", text: "I'm Afraid a Task Has Failed, Sir" },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${notification.taskTitle}*\nAgent: \`${notification.agent}\`\nError: \`\`\`${errorTruncated}\`\`\``,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Goal: *${notification.goalTitle}* · Task: \`${notification.taskId.slice(0, 8)}…\``,
                },
              ],
            },
          ],
        )
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: `Task failed, sir: ${notification.taskTitle}`,
            description: `Agent: ${notification.agent}\nError: ${errorTruncated}`,
            color: 0xe67e22, // orange
            footer: {
              text: `Goal: ${notification.goalTitle} · Task: ${notification.taskId.slice(0, 8)}…`,
            },
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify about goal progress (task started/completed) */
  async notifyGoalProgress(notification: GoalProgressNotification): Promise<void> {
    const emoji =
      notification.status === "completed"
        ? "\u2705"
        : notification.status === "failed"
          ? "\u274c"
          : "\ud83d\udd35";
    const text = `${emoji} ${notification.taskTitle} (${notification.agent}) — ${notification.completedTasks}/${notification.totalTasks} tasks`;

    const color =
      notification.status === "completed"
        ? 0x57f287
        : notification.status === "failed"
          ? 0xed4245
          : 0x5865f2; // blurple

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Goal: *${notification.goalTitle}* · \`${notification.goalId.slice(0, 8)}…\``,
              },
            ],
          },
        ])
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: `${emoji} Task ${notification.status}: ${notification.taskTitle}`,
            description: `Agent: ${notification.agent} · ${notification.completedTasks}/${notification.totalTasks} tasks`,
            color,
            footer: { text: `Goal: ${notification.goalTitle}` },
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify that a goal was proposed and needs approval before execution */
  async notifyGoalProposed(notification: GoalProposedNotification): Promise<void> {
    const scopeEmoji = notification.scope === "destructive" ? "\u{1F6A8}" : "\u26A0\uFE0F";
    const scopeLabel = notification.scope.charAt(0).toUpperCase() + notification.scope.slice(1);

    const slackPromise = this.hasSlack()
      ? this.sendSlack(
          this.slackChannel,
          `${scopeEmoji} Goal proposed: ${notification.goalTitle}`,
          [
            {
              type: "header",
              text: { type: "plain_text", text: `${scopeEmoji} A Proposed Objective Awaits Your Approval, Sir` },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${notification.goalTitle}*\nScope: \`${scopeLabel}\` · ${notification.taskCount} task(s)`,
              },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Approve" },
                  style: "primary",
                  action_id: "goal_approve",
                  value: notification.goalId,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "Reject" },
                  style: "danger",
                  action_id: "goal_reject",
                  value: notification.goalId,
                },
              ],
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Goal: \`${notification.goalId.slice(0, 8)}…\``,
                },
              ],
            },
          ],
        )
      : Promise.resolve();

    const discordColor = notification.scope === "destructive" ? 0xed4245 : 0xfee75c;
    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: `${scopeEmoji} Proposed objective awaits your approval, sir: ${notification.goalTitle}`,
            description: `Scope: **${scopeLabel}** · ${notification.taskCount} task(s)\n\nApprove or reject via the dashboard.`,
            color: discordColor,
            footer: { text: `Goal: ${notification.goalId.slice(0, 8)}…` },
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify about goals that have gone stale (no updates in 48h+) */
  async notifyStaleGoals(goals: Array<{ title: string; hoursStale: number }>): Promise<void> {
    const goalList = goals
      .slice(0, 5)
      .map((g) => `- **${g.title}** \u2014 ${g.hoursStale}h since last update`)
      .join("\n");

    const text = `Sir, ${goals.length} objective(s) appear to have stalled:\n\n${goalList}\n\nShall I proceed with execution, or would you prefer to close them out?`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "Sir, a Few Items Appear to Have Stalled" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ])
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "Sir, a few items appear to have stalled",
            description: text,
            color: 0xf0932b, // orange
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Remind about pending approvals that need attention */
  async notifyApprovalReminder(count: number): Promise<void> {
    const text = `There are **${count}** matter(s) awaiting your approval, sir, before execution can continue.\n\nUse \`/approve <id>\` to review at your convenience.`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "Matters Awaiting Your Approval, Sir" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ])
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "Matters awaiting your approval, sir",
            description: text,
            color: 0xfee75c, // amber
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify about inactivity with a suggested focus — prefers DM */
  async notifyQuietCheckIn(suggestion: string): Promise<void> {
    const text = `It's been rather quiet, sir. Might I suggest a focus area?\n\n${suggestion}`;
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ];

    const slackPromise = this.sendSlackPreferred(text, blocks);

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "Checking in, sir",
            description: text,
            color: 0x5865f2, // blurple
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Alert when dead-letter queue exceeds a threshold */
  async notifyDlqAlert(count: number, recentJobs: Array<{ originalQueue: string; failedReason: string; failedAt: string }>): Promise<void> {
    const jobList = recentJobs
      .slice(0, 5)
      .map((j) => `- \`${j.originalQueue}\`: ${j.failedReason.slice(0, 100)} (${j.failedAt})`)
      .join("\n");

    const text = `Sir, there are **${count}** unresolved system error(s) requiring attention:\n\n${jobList}\n\nReview at /dashboard/dlq or use the API to retry.`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "System Errors Requiring Attention, Sir" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ])
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "System errors requiring attention, sir",
            description: text,
            color: 0xed4245, // red
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Send a daily briefing — prefers DM for personal delivery */
  async sendBriefing(text: string): Promise<void> {
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "Morning Briefing, Sir" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ];
    const slackPromise = this.sendSlackPreferred(text, blocks);

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "Morning Briefing, Sir",
            description: text.slice(0, 4000),
            color: 0x5865f2, // blurple
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Send a Slack DM to the configured user (opens conversation first) */
  private async sendSlackDm(text: string, blocks: object[]): Promise<void> {
    if (!this.slackToken || !this.slackDmUserId) return;

    try {
      // Open DM conversation with user
      const openRes = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.slackToken}`,
        },
        body: JSON.stringify({ users: this.slackDmUserId }),
      });

      if (!openRes.ok) {
        logger.warn({ status: openRes.status }, "Failed to open Slack DM conversation");
        return;
      }

      const openData = (await openRes.json()) as { ok: boolean; channel?: { id: string }; error?: string };
      if (!openData.ok || !openData.channel) {
        logger.warn({ error: openData.error }, "Slack DM open failed");
        return;
      }

      await this.sendSlack(openData.channel.id, text, blocks);
    } catch (err) {
      logger.warn({ err }, "failed to send Slack DM");
    }
  }

  /** Determine best Slack channel: prefer DM if configured, else notification channel */
  async sendSlackPreferred(text: string, blocks: object[]): Promise<void> {
    if (this.slackDmUserId && this.slackToken) {
      await this.sendSlackDm(text, blocks);
    } else if (this.hasSlack()) {
      await this.sendSlack(this.slackChannel, text, blocks);
    }
  }

  private async sendSlack(
    channel: string,
    text: string,
    blocks: object[],
  ): Promise<void> {
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.slackToken}`,
        },
        body: JSON.stringify({ channel, text, blocks }),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, "Slack notification HTTP error");
        return;
      }

      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        logger.warn({ error: data.error }, "Slack API error sending notification");
      }
    } catch (err) {
      logger.warn({ err }, "failed to send Slack notification");
    }
  }

  private async sendDiscord(embeds: object[]): Promise<void> {
    try {
      const res = await fetch(this.discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds }),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, "Discord notification HTTP error");
      }
    } catch (err) {
      logger.warn({ err }, "failed to send Discord notification");
    }
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/** Create a NotificationService from env vars. Returns the service (may be unconfigured). */
export function createNotificationService(): NotificationService {
  return new NotificationService({
    slackToken: optionalEnv("SLACK_BOT_TOKEN", ""),
    slackChannel: optionalEnv("SLACK_NOTIFICATION_CHANNEL", ""),
    slackDmUserId: optionalEnv("SLACK_DM_USER_ID", ""),
    discordWebhookUrl: optionalEnv("DISCORD_NOTIFICATION_WEBHOOK_URL", ""),
  });
}

/**
 * Backwards-compatible thin wrapper.
 * Reads env vars and sends approval notification via Slack (and Discord if configured).
 */
export async function notifyApprovalCreated(approval: ApprovalNotification): Promise<void> {
  const service = createNotificationService();
  await service.notifyApprovalCreated(approval);
}

export async function notifyGoalProposed(notification: GoalProposedNotification): Promise<void> {
  const service = createNotificationService();
  await service.notifyGoalProposed(notification);
}
