import type { App } from "@slack/bolt";
import { ApiClient } from "@ai-cofounder/api-client";
import {
  handleAsk,
  handleAskStreaming,
  handleStatus,
  handleGoals,
  handleTasks,
  handleMemory,
  handleClear,
  handleExecute,
  handleApprove,
  handleReject,
  handleListApprovals,
  truncate,
  type CommandContext,
  type HandlerResult,
} from "@ai-cofounder/bot-handlers";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("slack-commands");

function createClient(): ApiClient {
  return new ApiClient({
    baseUrl: optionalEnv("AGENT_SERVER_URL", "http://localhost:3100"),
    apiSecret: process.env.API_SECRET || undefined,
  });
}

function makeContext(channelId: string, userId: string, userName: string): CommandContext {
  return {
    channelId: `slack-${channelId}`,
    userId,
    userName,
    platform: "slack",
  };
}

type RespondFn = (msg: string | Record<string, unknown>) => Promise<unknown>;

async function sendSlackResponse(respond: RespondFn, result: HandlerResult, ephemeral = false): Promise<void> {
  const base = ephemeral ? { response_type: "ephemeral" as const } : {};

  switch (result.type) {
    case "ask":
    case "ask_streaming": {
      const footer = [
        `Agent: ${result.data.agentRole}`,
        result.data.model ? `Model: ${result.data.model}` : null,
        result.data.usage
          ? `Tokens: ${result.data.usage.inputTokens}→${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: truncate(result.data.response, 3000) } },
          { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
        ],
      });
      return;
    }

    case "status":
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "AI Cofounder — System Status" } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Status:* ${result.data.status}` },
              { type: "mrkdwn", text: `*Uptime:* ${result.data.uptimeMinutes}m` },
            ],
          },
        ],
      });
      return;

    case "goals": {
      const lines = result.data.goals.map((g) => `${g.icon} *${g.title}* (${g.priority})`);
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Goals" } },
          { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
        ],
      });
      return;
    }

    case "tasks": {
      const lines = result.data.tasks.map((t) => `• *${t.title}* → ${t.assignedAgent}`);
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Pending Tasks" } },
          { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
          { type: "context", elements: [{ type: "mrkdwn", text: `${result.data.totalCount} pending task(s)` }] },
        ],
      });
      return;
    }

    case "memory": {
      const sections = result.data.sections.map(
        (s) => `*${s.category}*\n${s.items.map((i) => `*${i.key}:* ${i.content}`).join("\n")}`,
      );
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Memories" } },
          { type: "section", text: { type: "mrkdwn", text: truncate(sections.join("\n\n"), 3000) } },
          { type: "context", elements: [{ type: "mrkdwn", text: `${result.data.totalCount} memory(s)` }] },
        ],
      });
      return;
    }

    case "clear":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "✅ Conversation cleared. Next `/ask` starts fresh." } },
        ],
      });
      return;

    case "execute": {
      const taskLines = result.data.tasks.map(
        (t) => `${t.icon} *${t.title}* (${t.agent}) — ${t.status}`,
      );
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: `Executing: ${result.data.goalTitle}` } },
          { type: "section", text: { type: "mrkdwn", text: taskLines.join("\n") } },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${result.data.completedTasks}/${result.data.totalTasks} tasks completed · Status: ${result.data.status}`,
              },
            ],
          },
        ],
      });
      return;
    }

    case "approve":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `✅ Approval \`${result.data.approvalId}\` approved.` } },
        ],
      });
      return;

    case "reject":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `❌ Approval \`${result.data.approvalId}\` rejected.` } },
        ],
      });
      return;

    case "approvals": {
      const blocks: Record<string, unknown>[] = [
        { type: "header", text: { type: "plain_text", text: "Pending Approvals" } },
      ];

      for (const a of result.data.approvals) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${a.reason}*\nRequested by: \`${a.requestedBy}\` · Task: \`${a.taskId.slice(0, 8)}…\``,
          },
        });
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve" },
              style: "primary",
              action_id: "approval_approve",
              value: a.id,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject" },
              style: "danger",
              action_id: "approval_reject",
              value: a.id,
            },
          ],
        });
      }

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `${result.data.totalCount} pending approval(s)` }],
      });

      await respond({ ...base, blocks });
      return;
    }

    case "info":
      await respond({ ...base, text: result.message });
      return;

    case "error":
      await respond({ ...base, text: result.message });
      return;
  }
}

export function registerCommands(app: App): void {
  const client = createClient();

  app.command("/ask", async ({ command, ack, respond, client: slackClient }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);

    // Post initial thinking message
    const initial = await slackClient.chat.postMessage({
      channel: command.channel_id,
      text: "Thinking...",
    });

    let lastEditTime = 0;
    const THROTTLE_MS = 1500;
    const ts = initial.ts;

    const result = await handleAskStreaming(client, ctx, command.text, async (text) => {
      const now = Date.now();
      if (ts && now - lastEditTime >= THROTTLE_MS) {
        lastEditTime = now;
        try {
          await slackClient.chat.update({
            channel: command.channel_id,
            ts,
            text: truncate(text, 3000),
          });
        } catch {
          /* edit failures during streaming are non-fatal */
        }
      }
    });

    // Final update with formatted response
    if (ts && (result.type === "ask_streaming" || result.type === "ask")) {
      const footer = [
        `Agent: ${result.data.agentRole}`,
        result.data.model ? `Model: ${result.data.model}` : null,
        result.data.usage
          ? `Tokens: ${result.data.usage.inputTokens}→${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

      await slackClient.chat.update({
        channel: command.channel_id,
        ts,
        text: truncate(result.data.response, 3000),
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: truncate(result.data.response, 3000) } },
          { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
        ],
      });
    } else {
      await sendSlackResponse(respond, result);
    }
  });

  app.command("/status", async ({ ack, respond }) => {
    await ack();
    await sendSlackResponse(respond, await handleStatus(client));
  });

  app.command("/goals", async ({ command, ack, respond }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleGoals(client, ctx));
  });

  app.command("/tasks", async ({ ack, respond }) => {
    await ack();
    await sendSlackResponse(respond, await handleTasks(client));
  });

  app.command("/memory", async ({ command, ack, respond }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleMemory(client, ctx), true);
  });

  app.command("/clear", async ({ command, ack, respond }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleClear(client, ctx));
  });

  app.command("/execute", async ({ command, ack, respond }) => {
    await ack();
    const goalId = command.text.trim();
    if (!goalId) {
      await respond("Usage: `/execute <goal_id>`");
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleExecute(client, ctx, goalId));
  });

  app.command("/approve", async ({ command, ack, respond }) => {
    await ack();
    const approvalId = command.text.trim();
    if (!approvalId) {
      await respond("Usage: `/approve <approval_id>`");
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleApprove(client, ctx, approvalId));
  });

  app.command("/approvals", async ({ ack, respond }) => {
    await ack();
    await sendSlackResponse(respond, await handleListApprovals(client));
  });

  // Interactive button handlers
  app.action("approval_approve", async ({ action, ack, respond, body }) => {
    await ack();
    const approvalId = (action as { value: string }).value;
    const user = body.user as { id: string; name?: string; username?: string };
    const ctx = makeContext(
      body.channel?.id ?? "unknown",
      user.id,
      user.name ?? user.username ?? "unknown",
    );
    const result = await handleApprove(client, ctx, approvalId);
    await sendSlackResponse(respond, result);
  });

  app.action("approval_reject", async ({ action, ack, respond, body }) => {
    await ack();
    const approvalId = (action as { value: string }).value;
    const user = body.user as { id: string; name?: string; username?: string };
    const ctx = makeContext(
      body.channel?.id ?? "unknown",
      user.id,
      user.name ?? user.username ?? "unknown",
    );
    const result = await handleReject(client, ctx, approvalId);
    await sendSlackResponse(respond, result);
  });

  // Event: app_mention — respond when @mentioned in channels
  app.event("app_mention", async ({ event, say, client: slackClient }) => {
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;
    if (!event.user) return;

    const ctx = makeContext(event.channel, event.user, event.user);
    const initial = await slackClient.chat.postMessage({ channel: event.channel, text: "Thinking..." });
    const ts = initial.ts;
    let lastEditTime = 0;

    const result = await handleAskStreaming(client, ctx, text, async (chunk) => {
      const now = Date.now();
      if (ts && now - lastEditTime >= 1500) {
        lastEditTime = now;
        try { await slackClient.chat.update({ channel: event.channel, ts, text: truncate(chunk, 3000) }); } catch { /* non-fatal */ }
      }
    });

    if (ts && (result.type === "ask_streaming" || result.type === "ask")) {
      await slackClient.chat.update({ channel: event.channel, ts, text: truncate(result.data.response, 3000) });
    } else {
      await sendSlackResponse(say as RespondFn, result);
    }
  });

  // Event: message — respond to DMs
  app.event("message", async ({ event, say, client: slackClient }) => {
    const msg = event as unknown as Record<string, unknown>;
    if (msg.channel_type !== "im") return;
    if (msg.subtype) return;
    if (!msg.text || !msg.user || !msg.channel) return;

    const channel = msg.channel as string;
    const ctx = makeContext(channel, msg.user as string, msg.user as string);
    const initial = await slackClient.chat.postMessage({ channel, text: "Thinking..." });
    const ts = initial.ts;
    let lastEditTime = 0;

    const result = await handleAskStreaming(client, ctx, msg.text as string, async (chunk) => {
      const now = Date.now();
      if (ts && now - lastEditTime >= 1500) {
        lastEditTime = now;
        try { await slackClient.chat.update({ channel, ts, text: truncate(chunk, 3000) }); } catch { /* non-fatal */ }
      }
    });

    if (ts && (result.type === "ask_streaming" || result.type === "ask")) {
      await slackClient.chat.update({ channel, ts, text: truncate(result.data.response, 3000) });
    } else {
      await sendSlackResponse(say as RespondFn, result);
    }
  });
}
