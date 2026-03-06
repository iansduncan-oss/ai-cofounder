import type { App } from "@slack/bolt";
import { ApiClient } from "@ai-cofounder/api-client";
import {
  handleAsk,
  handleStatus,
  handleGoals,
  handleTasks,
  handleMemory,
  handleClear,
  handleExecute,
  handleApprove,
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
    case "ask": {
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

  app.command("/ask", async ({ command, ack, respond }) => {
    await ack();
    const ctx = makeContext(command.channel_id, command.user_id, command.user_name);
    const result = await handleAsk(client, ctx, command.text);
    await sendSlackResponse(respond, result);
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
}
