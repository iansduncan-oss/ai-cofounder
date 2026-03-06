import type { App } from "@slack/bolt";
import { ApiClient, ApiError } from "@ai-cofounder/api-client";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("slack-commands");

function createClient(): ApiClient {
  return new ApiClient({
    baseUrl: optionalEnv("AGENT_SERVER_URL", "http://localhost:3100"),
    apiSecret: process.env.API_SECRET || undefined,
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

const STATUS_ICON: Record<string, string> = {
  draft: "📝",
  active: "🔵",
  completed: "✅",
  cancelled: "❌",
  failed: "❌",
  in_progress: "🔵",
  awaiting_approval: "⏳",
};

export function registerCommands(app: App): void {
  const client = createClient();

  app.command("/ask", async ({ command, ack, respond }) => {
    await ack();

    try {
      const channelId = `slack-${command.channel_id}`;
      let conversationId: string | undefined;

      try {
        const mapping = await client.getChannelConversation(channelId);
        conversationId = mapping.conversationId;
      } catch {
        // No existing conversation — that's fine
      }

      const result = await client.runAgent({
        message: command.text,
        userId: command.user_id,
        platform: "slack",
        conversationId,
      });

      try {
        await client.setChannelConversation(channelId, result.conversationId, "slack");
      } catch (err) {
        logger.warn({ err, channelId }, "failed to persist conversation mapping");
      }

      const footer = [
        `Agent: ${result.agentRole}`,
        result.model ? `Model: ${result.model}` : null,
        result.usage ? `Tokens: ${result.usage.inputTokens}→${result.usage.outputTokens}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: truncate(result.response, 3000) },
          },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: footer }],
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "ask command failed");
      await respond("Something went wrong talking to the AI Cofounder. Is the agent server running?");
    }
  });

  app.command("/status", async ({ ack, respond }) => {
    await ack();

    try {
      const health = await client.health();
      const uptimeMinutes = Math.floor(health.uptime / 60);

      await respond({
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "AI Cofounder — System Status" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Status:* ${health.status}` },
              { type: "mrkdwn", text: `*Uptime:* ${uptimeMinutes}m` },
            ],
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "status command failed");
      await respond(`Agent server unreachable at ${optionalEnv("AGENT_SERVER_URL", "http://localhost:3100")}`);
    }
  });

  app.command("/goals", async ({ command, ack, respond }) => {
    await ack();

    try {
      const channelId = `slack-${command.channel_id}`;
      let conversationId: string;

      try {
        const mapping = await client.getChannelConversation(channelId);
        conversationId = mapping.conversationId;
      } catch {
        await respond("No conversation in this channel yet. Use `/ask` first.");
        return;
      }

      const goals = await client.listGoals(conversationId);

      if (goals.length === 0) {
        await respond("No goals yet for this channel.");
        return;
      }

      const lines = goals.map(
        (g) => `${STATUS_ICON[g.status] ?? "⚪"} *${g.title}* (${g.priority})`,
      );

      await respond({
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Goals" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: lines.join("\n") },
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "goals command failed");
      await respond("Failed to fetch goals.");
    }
  });

  app.command("/tasks", async ({ ack, respond }) => {
    await ack();

    try {
      const tasks = await client.listPendingTasks();

      if (tasks.length === 0) {
        await respond("No pending tasks.");
        return;
      }

      const lines = tasks
        .slice(0, 15)
        .map((t) => `• *${t.title}* → ${t.assignedAgent ?? "unassigned"}`);

      await respond({
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Pending Tasks" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: lines.join("\n") },
          },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `${tasks.length} pending task(s)` }],
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "tasks command failed");
      await respond("Failed to fetch tasks.");
    }
  });

  app.command("/memory", async ({ command, ack, respond }) => {
    await ack();

    try {
      let userId: string;
      try {
        const user = await client.getUserByPlatform("slack", command.user_id);
        userId = user.id;
      } catch {
        await respond({
          response_type: "ephemeral",
          text: "I don't have any memories of you yet. Start a conversation with `/ask` first!",
        });
        return;
      }

      const memories = await client.listMemories(userId);

      if (memories.length === 0) {
        await respond({
          response_type: "ephemeral",
          text: "I know who you are, but I haven't saved any memories yet. Chat with me via `/ask` and I'll start remembering!",
        });
        return;
      }

      const grouped = new Map<string, string[]>();
      for (const m of memories) {
        const list = grouped.get(m.category) ?? [];
        list.push(`*${m.key}:* ${m.content}`);
        grouped.set(m.category, list);
      }

      const sections = [...grouped.entries()].map(
        ([cat, items]) => `*${cat}*\n${items.join("\n")}`,
      );

      await respond({
        response_type: "ephemeral",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `Memories — ${command.user_name}` },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: truncate(sections.join("\n\n"), 3000) },
          },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `${memories.length} memory(s)` }],
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "memory command failed");
      await respond({ response_type: "ephemeral", text: "Failed to fetch memories." });
    }
  });

  app.command("/clear", async ({ command, ack, respond }) => {
    await ack();

    try {
      const channelId = `slack-${command.channel_id}`;
      await client.deleteChannelConversation(channelId);

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "✅ Conversation cleared. Next `/ask` starts fresh." },
          },
        ],
      });
    } catch (err) {
      logger.error({ err }, "clear command failed");
      await respond("Failed to clear conversation.");
    }
  });

  app.command("/execute", async ({ command, ack, respond }) => {
    await ack();

    const goalId = command.text.trim();
    if (!goalId) {
      await respond("Usage: `/execute <goal_id>`");
      return;
    }

    try {
      const data = await client.executeGoal(goalId, { userId: command.user_id });

      const taskLines = data.tasks.map(
        (t) => `${STATUS_ICON[t.status] ?? "⚪"} *${t.title}* (${t.agent}) — ${t.status}`,
      );

      await respond({
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: `Executing: ${data.goalTitle}` },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: taskLines.join("\n") },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `${data.completedTasks}/${data.totalTasks} tasks completed · Status: ${data.status}`,
              },
            ],
          },
        ],
      });
    } catch (err) {
      logger.error({ err, goalId }, "execute command failed");
      await respond(`Failed to execute goal: ${goalId}`);
    }
  });

  app.command("/approve", async ({ command, ack, respond }) => {
    await ack();

    const approvalId = command.text.trim();
    if (!approvalId) {
      await respond("Usage: `/approve <approval_id>`");
      return;
    }

    try {
      await client.resolveApproval(approvalId, {
        status: "approved",
        decision: `Approved by ${command.user_name} via Slack`,
      });

      await respond({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `✅ Approval \`${approvalId}\` approved.` },
          },
        ],
      });
    } catch (err) {
      logger.error({ err, approvalId }, "approve command failed");
      await respond(`Failed to approve: ${approvalId}`);
    }
  });
}
