import { createLogger, optionalEnv } from "@ai-cofounder/shared";

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

interface NotificationConfig {
  slackToken?: string;
  slackChannel?: string;
  discordWebhookUrl?: string;
}

export class NotificationService {
  private slackToken: string;
  private slackChannel: string;
  private discordWebhookUrl: string;

  constructor(config: NotificationConfig) {
    this.slackToken = config.slackToken ?? "";
    this.slackChannel = config.slackChannel ?? "";
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
              text: { type: "plain_text", text: "Approval Required" },
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
            title: `Approval Required: ${approval.reason}`,
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
    const title = isSuccess ? "Goal Completed" : "Goal Failed";
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
              text: { type: "plain_text", text: "\u274c Task Failed" },
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
            title: `Task Failed: ${notification.taskTitle}`,
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

  /** Notify about goals that have gone stale (no updates in 48h+) */
  async notifyStaleGoals(goals: Array<{ title: string; hoursStale: number }>): Promise<void> {
    const goalList = goals
      .slice(0, 5)
      .map((g) => `- **${g.title}** \u2014 ${g.hoursStale}h since last update`)
      .join("\n");

    const text = `${goals.length} goal(s) sitting idle:\n\n${goalList}\n\nWant to \`/execute\` them or close them out?`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "Goals going cold" },
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
            title: "Goals going cold",
            description: text,
            color: 0xf0932b, // orange
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Remind about pending approvals that need attention */
  async notifyApprovalReminder(count: number): Promise<void> {
    const text = `**${count}** task(s) need your sign-off before execution can continue.\n\nUse \`/approve <id>\` to review and approve.`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "Approvals waiting on you" },
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
            title: "Approvals waiting on you",
            description: text,
            color: 0xfee75c, // amber
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Notify about inactivity with a suggested focus */
  async notifyQuietCheckIn(suggestion: string): Promise<void> {
    const text = `Haven't heard from you in a while. Here's what I'd suggest focusing on:\n\n${suggestion}`;

    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ])
      : Promise.resolve();

    const discordPromise = this.hasDiscord()
      ? this.sendDiscord([
          {
            title: "Checking in",
            description: text,
            color: 0x5865f2, // blurple
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
  }

  /** Send a daily briefing to configured channels */
  async sendBriefing(text: string): Promise<void> {
    const slackPromise = this.hasSlack()
      ? this.sendSlack(this.slackChannel, text, [
          {
            type: "header",
            text: { type: "plain_text", text: "Daily Briefing" },
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
            title: "Daily Briefing",
            description: text.slice(0, 4000),
            color: 0x5865f2, // blurple
          },
        ])
      : Promise.resolve();

    await Promise.allSettled([slackPromise, discordPromise]);
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
