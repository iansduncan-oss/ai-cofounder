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
  handleExecuteStreaming,
  handleApprove,
  handleReject,
  handleListApprovals,
  handleHelp,
  handleScheduleList,
  handleScheduleCreate,
  handleGmailInbox,
  handleGmailSend,
  handleRegister,
  checkCooldown,
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
          ? `Tokens: ${result.data.usage.inputTokens}\u2192${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" \u00b7 ");

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
          { type: "header", text: { type: "plain_text", text: "AI Cofounder \u2014 System Status" } },
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
      const lines = result.data.tasks.map((t) => `\u2022 *${t.title}* \u2192 ${t.assignedAgent}`);
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
          { type: "section", text: { type: "mrkdwn", text: "\u2705 Conversation cleared. Next `/ask` starts fresh." } },
        ],
      });
      return;

    case "execute": {
      const taskLines = result.data.tasks.map(
        (t) => `${t.icon} *${t.title}* (${t.agent}) \u2014 ${t.status}`,
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
                text: `${result.data.completedTasks}/${result.data.totalTasks} tasks completed \u00b7 Status: ${result.data.status}`,
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
          { type: "section", text: { type: "mrkdwn", text: `\u2705 Approval \`${result.data.approvalId}\` approved.` } },
        ],
      });
      return;

    case "reject":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `\u274c Approval \`${result.data.approvalId}\` rejected.` } },
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
            text: `*${a.reason}*\nRequested by: \`${a.requestedBy}\` \u00b7 Task: \`${a.taskId.slice(0, 8)}\u2026\``,
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

    case "help": {
      const lines = result.data.commands.map((c) => `*${c.name}* \u2014 ${c.description}`);
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "AI Cofounder \u2014 Commands" } },
          { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
        ],
      });
      return;
    }

    case "schedule_list": {
      const lines = result.data.schedules.map(
        (s) => `${s.enabled ? "\u2705" : "\u23f8\ufe0f"} \`${s.cronExpression}\` \u2014 ${s.description ?? "No description"}\nNext: ${s.nextRunAt}`,
      );
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Schedules" } },
          { type: "section", text: { type: "mrkdwn", text: lines.join("\n\n") } },
          { type: "context", elements: [{ type: "mrkdwn", text: `${result.data.totalCount} schedule(s)` }] },
        ],
      });
      return;
    }

    case "schedule_create":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `\u2705 *Schedule Created*\n\`${result.data.cronExpression}\` \u2014 ${result.data.description ?? "No description"}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `ID: ${result.data.id}` }] },
        ],
      });
      return;

    case "gmail_inbox": {
      const lines = result.data.messages.map(
        (m) => `${m.isUnread ? "*" : ""}${m.from}: ${m.subject}${m.isUnread ? "*" : ""} \u2014 ${m.date}`,
      );
      await respond({
        ...base,
        blocks: [
          { type: "header", text: { type: "plain_text", text: "Gmail Inbox" } },
          { type: "section", text: { type: "mrkdwn", text: truncate(lines.join("\n"), 3000) } },
          { type: "context", elements: [{ type: "mrkdwn", text: `${result.data.unreadCount} unread` }] },
        ],
      });
      return;
    }

    case "gmail_send":
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `\u2705 Email sent to *${result.data.to}*: ${result.data.subject}` } },
        ],
      });
      return;

    case "register": {
      const msg = result.data.isNew
        ? `\u2705 Welcome, *${result.data.displayName ?? "friend"}*! You're now registered with AI Cofounder.`
        : `\u2705 You're already registered, *${result.data.displayName ?? "friend"}*!`;
      await respond({
        ...base,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: msg } },
        ],
      });
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
    const remaining = checkCooldown(ctx.userId, "ask");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""} before using \`/ask\` again.` });
      return;
    }

    // Post initial thinking message in a thread
    const initial = await slackClient.chat.postMessage({
      channel: command.channel_id,
      text: `<@${command.user_id}> asked: ${truncate(command.text, 100)}`,
    });

    const threadTs = initial.ts;

    // Stream reply within thread
    const thinkingMsg = await slackClient.chat.postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: "Thinking...",
    });

    let lastEditTime = 0;
    const THROTTLE_MS = 1500;
    const replyTs = thinkingMsg.ts;

    const result = await handleAskStreaming(client, ctx, command.text, async (text) => {
      const now = Date.now();
      if (replyTs && now - lastEditTime >= THROTTLE_MS) {
        lastEditTime = now;
        try {
          await slackClient.chat.update({
            channel: command.channel_id,
            ts: replyTs,
            text: truncate(text, 3000),
          });
        } catch {
          /* edit failures during streaming are non-fatal */
        }
      }
    });

    // Final update with formatted response
    if (replyTs && (result.type === "ask_streaming" || result.type === "ask")) {
      const footer = [
        `Agent: ${result.data.agentRole}`,
        result.data.model ? `Model: ${result.data.model}` : null,
        result.data.usage
          ? `Tokens: ${result.data.usage.inputTokens}\u2192${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" \u00b7 ");

      await slackClient.chat.update({
        channel: command.channel_id,
        ts: replyTs,
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

  app.command("/status", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "status");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    await sendSlackResponse(respond, await handleStatus(client));
  });

  app.command("/goals", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "goals");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleGoals(client, ctx));
  });

  app.command("/tasks", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "tasks");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    await sendSlackResponse(respond, await handleTasks(client));
  });

  app.command("/memory", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "memory");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleMemory(client, ctx), true);
  });

  app.command("/clear", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "clear");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleClear(client, ctx));
  });

  app.command("/execute", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "execute");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""} before using \`/execute\` again.` });
      return;
    }
    const goalId = command.text.trim();
    if (!goalId) {
      await respond("Usage: `/execute <goal_id>`");
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    let lastUpdate = 0;
    const result = await handleExecuteStreaming(client, ctx, goalId, async (text) => {
      const now = Date.now();
      if (now - lastUpdate > 2000) {
        lastUpdate = now;
        try { await respond({ response_type: "in_channel", text: truncate(text, 3000), replace_original: true }); } catch { /* non-fatal */ }
      }
    });
    await sendSlackResponse(respond, result);
  });

  app.command("/approve", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "approve");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    const approvalId = command.text.trim();
    if (!approvalId) {
      await respond("Usage: `/approve <approval_id>`");
      return;
    }
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleApprove(client, ctx, approvalId));
  });

  app.command("/approvals", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "approvals");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    await sendSlackResponse(respond, await handleListApprovals(client));
  });

  app.command("/register", async ({ command, ack, respond }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    await sendSlackResponse(respond, await handleRegister(client, ctx), true);
  });

  app.command("/help", async ({ ack, respond }) => {
    await ack();
    await sendSlackResponse(respond, handleHelp(), true);
  });

  app.command("/schedule", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "schedule");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }

    const text = command.text.trim();
    const parts = text.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    if (!subcommand || subcommand === "list") {
      await sendSlackResponse(respond, await handleScheduleList(client));
    } else if (subcommand === "create") {
      // Parse: /schedule create <cron (5 fields)> <task description>
      // Cron has 5 space-separated fields, then the rest is the task
      const rest = parts.slice(1);
      if (rest.length < 6) {
        await respond("Usage: `/schedule create <min> <hour> <day> <month> <weekday> <task description>`\nExample: `/schedule create 0 9 * * 1-5 Review and prioritize today's work`");
        return;
      }
      const cronExpression = rest.slice(0, 5).join(" ");
      const actionPrompt = rest.slice(5).join(" ");
      await sendSlackResponse(
        respond,
        await handleScheduleCreate(client, cronExpression, actionPrompt, command.user_id),
      );
    } else {
      await respond("Usage: `/schedule list` or `/schedule create <cron> <task>`");
    }
  });

  app.command("/gmail-inbox", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "gmail-inbox");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    await sendSlackResponse(respond, await handleGmailInbox(client));
  });

  app.command("/gmail-send", async ({ command, ack, respond }) => {
    await ack();
    const remaining = checkCooldown(command.user_id, "gmail-send");
    if (remaining !== null) {
      await respond({ response_type: "ephemeral", text: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""}.` });
      return;
    }
    // Parse: /gmail-send <to> <subject> | <body>
    const text = command.text.trim();
    const parts = text.split("|");
    if (parts.length < 2) {
      await respond("Usage: `/gmail-send <to> <subject> | <body>`\nExample: `/gmail-send bob@example.com Meeting tomorrow | Let's meet at 10am`");
      return;
    }
    const headerParts = parts[0].trim().split(/\s+/);
    if (headerParts.length < 2) {
      await respond("Usage: `/gmail-send <to> <subject> | <body>`");
      return;
    }
    const to = headerParts[0];
    const subject = headerParts.slice(1).join(" ");
    const body = parts.slice(1).join("|").trim();
    await sendSlackResponse(respond, await handleGmailSend(client, { to, subject, body }));
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

  // Event: app_mention — respond when @mentioned in channels (in thread)
  app.event("app_mention", async ({ event, client: slackClient }) => {
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!text) return;
    if (!event.user) return;

    const ctx = makeContext(event.channel, event.user, event.user);

    // Reply in thread — use existing thread_ts if already in a thread, else use message ts
    const threadTs = (event as unknown as { thread_ts?: string }).thread_ts ?? event.ts;

    const initial = await slackClient.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: "Thinking...",
    });
    const replyTs = initial.ts;
    let lastEditTime = 0;

    const result = await handleAskStreaming(client, ctx, text, async (chunk) => {
      const now = Date.now();
      if (replyTs && now - lastEditTime >= 1500) {
        lastEditTime = now;
        try { await slackClient.chat.update({ channel: event.channel, ts: replyTs, text: truncate(chunk, 3000) }); } catch { /* non-fatal */ }
      }
    });

    if (replyTs && (result.type === "ask_streaming" || result.type === "ask")) {
      await slackClient.chat.update({ channel: event.channel, ts: replyTs, text: truncate(result.data.response, 3000) });
    }
  });

  // Event: message — respond to DMs (in thread)
  app.event("message", async ({ event, client: slackClient }) => {
    const msg = event as unknown as Record<string, unknown>;
    if (msg.channel_type !== "im") return;
    if (msg.subtype) return;
    if (!msg.text || !msg.user || !msg.channel) return;

    const channel = msg.channel as string;
    const ctx = makeContext(channel, msg.user as string, msg.user as string);

    // Reply in thread using the original message as parent
    const threadTs = (msg.thread_ts as string | undefined) ?? (msg.ts as string);

    const initial = await slackClient.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Thinking...",
    });
    const replyTs = initial.ts;
    let lastEditTime = 0;

    const result = await handleAskStreaming(client, ctx, msg.text as string, async (chunk) => {
      const now = Date.now();
      if (replyTs && now - lastEditTime >= 1500) {
        lastEditTime = now;
        try { await slackClient.chat.update({ channel, ts: replyTs, text: truncate(chunk, 3000) }); } catch { /* non-fatal */ }
      }
    });

    if (replyTs && (result.type === "ask_streaming" || result.type === "ask")) {
      await slackClient.chat.update({ channel, ts: replyTs, text: truncate(result.data.response, 3000) });
    }
  });
}
