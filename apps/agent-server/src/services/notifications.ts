import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("notifications");

interface ApprovalNotification {
  approvalId: string;
  taskId: string;
  reason: string;
  requestedBy: string;
}

/**
 * Posts approval notification to configured Slack channel with Approve/Reject buttons.
 * Requires SLACK_BOT_TOKEN and SLACK_NOTIFICATION_CHANNEL env vars.
 * No-ops silently if not configured.
 */
export async function notifyApprovalCreated(approval: ApprovalNotification): Promise<void> {
  const token = optionalEnv("SLACK_BOT_TOKEN", "");
  const channel = optionalEnv("SLACK_NOTIFICATION_CHANNEL", "");

  if (!token || !channel) return;

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel,
        text: `Approval requested: ${approval.reason}`,
        blocks: [
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
      }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Slack notification HTTP error");
      return;
    }

    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      logger.warn({ error: data.error }, "Slack API error sending approval notification");
    } else {
      logger.info({ approvalId: approval.approvalId, channel }, "approval notification sent to Slack");
    }
  } catch (err) {
    logger.warn({ err }, "failed to send Slack approval notification");
  }
}
