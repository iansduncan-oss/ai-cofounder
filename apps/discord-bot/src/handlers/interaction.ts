import { type Interaction, type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("interaction-handler");

const AGENT_SERVER_URL = optionalEnv("AGENT_SERVER_URL", "http://localhost:3100");

interface AgentResponse {
  conversationId: string;
  agentRole: string;
  response: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

async function getChannelConversationId(channelId: string): Promise<string | null> {
  try {
    const res = await fetch(`${AGENT_SERVER_URL}/api/channels/${channelId}/conversation`);
    if (!res.ok) return null;
    const data = (await res.json()) as { conversationId: string };
    return data.conversationId;
  } catch {
    return null;
  }
}

async function saveChannelConversationId(channelId: string, conversationId: string): Promise<void> {
  try {
    await fetch(`${AGENT_SERVER_URL}/api/channels/${channelId}/conversation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, platform: "discord" }),
    });
  } catch (err) {
    logger.warn({ err, channelId }, "failed to persist conversation mapping");
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "ask":
      return handleAsk(interaction);
    case "status":
      return handleStatus(interaction);
    case "goals":
      return handleGoals(interaction);
    case "tasks":
      return handleTasks(interaction);
    case "memory":
      return handleMemory(interaction);
    case "clear":
      return handleClear(interaction);
    case "execute":
      return handleExecute(interaction);
    case "approve":
      return handleApprove(interaction);
    default:
      logger.warn({ command: interaction.commandName }, "unknown command");
  }
}

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString("message", true);
  const channelId = interaction.channelId;

  await interaction.deferReply();

  try {
    const payload: Record<string, unknown> = {
      message,
      userId: interaction.user.id,
      platform: "discord",
    };

    const existingConvId = await getChannelConversationId(channelId);
    if (existingConvId) {
      payload.conversationId = existingConvId;
    }

    const res = await fetch(`${AGENT_SERVER_URL}/api/agents/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Agent server returned ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as AgentResponse;

    await saveChannelConversationId(channelId, data.conversationId);

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setDescription(truncate(data.response, 4096))
      .setFooter({
        text: [
          `Agent: ${data.agentRole}`,
          data.model ? `Model: ${data.model}` : null,
          data.usage ? `Tokens: ${data.usage.inputTokens}→${data.usage.outputTokens}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, channelId }, "ask command failed");
    await interaction.editReply({
      content: "Something went wrong talking to the AI Cofounder. Is the agent server running?",
    });
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const res = await fetch(`${AGENT_SERVER_URL}/health`);

    if (!res.ok) {
      throw new Error(`Health check returned ${res.status}`);
    }

    const data = (await res.json()) as {
      status: string;
      timestamp: string;
      uptime: number;
    };

    const uptimeMinutes = Math.floor(data.uptime / 60);

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("AI Cofounder — System Status")
      .addFields(
        { name: "Status", value: `${data.status}`, inline: true },
        { name: "Uptime", value: `${uptimeMinutes}m`, inline: true },
        { name: "Server", value: AGENT_SERVER_URL, inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "status command failed");
    await interaction.editReply({
      content: `Agent server unreachable at ${AGENT_SERVER_URL}`,
    });
  }
}

async function handleGoals(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const convId = await getChannelConversationId(interaction.channelId);
    if (!convId) {
      await interaction.editReply({
        content: "No conversation in this channel yet. Use `/ask` first.",
      });
      return;
    }

    const res = await fetch(`${AGENT_SERVER_URL}/api/goals?conversationId=${convId}`);
    if (!res.ok) throw new Error(`Failed to fetch goals: ${res.status}`);

    const goals = (await res.json()) as Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
    }>;

    if (goals.length === 0) {
      await interaction.editReply({ content: "No goals yet for this channel." });
      return;
    }

    const statusIcon: Record<string, string> = {
      draft: "📝",
      active: "🔵",
      completed: "✅",
      cancelled: "❌",
    };

    const lines = goals.map(
      (g) => `${statusIcon[g.status] ?? "⚪"} **${g.title}** (${g.priority})`,
    );

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle("Goals")
      .setDescription(lines.join("\n"));

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "goals command failed");
    await interaction.editReply({ content: "Failed to fetch goals." });
  }
}

async function handleTasks(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const res = await fetch(`${AGENT_SERVER_URL}/api/tasks/pending`);
    if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);

    const tasks = (await res.json()) as Array<{
      id: string;
      title: string;
      status: string;
      assignedAgent?: string;
    }>;

    if (tasks.length === 0) {
      await interaction.editReply({ content: "No pending tasks." });
      return;
    }

    const lines = tasks
      .slice(0, 15)
      .map((t) => `• **${t.title}** → ${t.assignedAgent ?? "unassigned"}`);

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Pending Tasks")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${tasks.length} pending task(s)` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "tasks command failed");
    await interaction.editReply({ content: "Failed to fetch tasks." });
  }
}

async function handleMemory(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Look up user by platform ID, then fetch their memories
    const userRes = await fetch(
      `${AGENT_SERVER_URL}/api/users/by-platform/discord/${interaction.user.id}`,
    );

    if (!userRes.ok) {
      await interaction.editReply({
        content: "I don't have any memories of you yet. Start a conversation with `/ask` first!",
      });
      return;
    }

    const user = (await userRes.json()) as { id: string; displayName?: string };
    const memRes = await fetch(`${AGENT_SERVER_URL}/api/memories?userId=${user.id}`);

    if (!memRes.ok) {
      throw new Error(`Failed to fetch memories: ${memRes.status}`);
    }

    const memories = (await memRes.json()) as Array<{
      category: string;
      key: string;
      content: string;
    }>;

    if (memories.length === 0) {
      await interaction.editReply({
        content:
          "I know who you are, but I haven't saved any memories yet. Chat with me via `/ask` and I'll start remembering!",
      });
      return;
    }

    const grouped = new Map<string, string[]>();
    for (const m of memories) {
      const list = grouped.get(m.category) ?? [];
      list.push(`**${m.key}**: ${m.content}`);
      grouped.set(m.category, list);
    }

    const sections = [...grouped.entries()].map(
      ([cat, items]) => `**${cat}**\n${items.join("\n")}`,
    );

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`Memories — ${interaction.user.username}`)
      .setDescription(truncate(sections.join("\n\n"), 4096))
      .setFooter({ text: `${memories.length} memory(s)` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "memory command failed");
    await interaction.editReply({ content: "Failed to fetch memories." });
  }
}

async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    // Remove the channel-conversation mapping so next /ask starts fresh
    await fetch(`${AGENT_SERVER_URL}/api/channels/${interaction.channelId}/conversation`, {
      method: "DELETE",
    });

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setDescription("Conversation cleared. Next `/ask` starts fresh.");

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "clear command failed");
    await interaction.editReply({ content: "Failed to clear conversation." });
  }
}

async function handleExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const goalId = interaction.options.getString("goal_id", true);

  await interaction.deferReply();

  try {
    const res = await fetch(`${AGENT_SERVER_URL}/api/goals/${goalId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: interaction.user.id }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Execution failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      goalTitle: string;
      status: string;
      totalTasks: number;
      completedTasks: number;
      tasks: Array<{ title: string; agent: string; status: string }>;
    };

    const statusIcon: Record<string, string> = {
      completed: "✅",
      failed: "❌",
      in_progress: "🔵",
      awaiting_approval: "⏳",
    };

    const taskLines = data.tasks.map(
      (t) => `${statusIcon[t.status] ?? "⚪"} **${t.title}** (${t.agent}) — ${t.status}`,
    );

    const embed = new EmbedBuilder()
      .setColor(
        data.status === "completed" ? 0x22c55e : data.status === "failed" ? 0xef4444 : 0x7c3aed,
      )
      .setTitle(`Executing: ${data.goalTitle}`)
      .setDescription(taskLines.join("\n"))
      .setFooter({
        text: `${data.completedTasks}/${data.totalTasks} tasks completed · Status: ${data.status}`,
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, goalId }, "execute command failed");
    await interaction.editReply({ content: `Failed to execute goal: ${goalId}` });
  }
}

async function handleApprove(interaction: ChatInputCommandInteraction): Promise<void> {
  const approvalId = interaction.options.getString("approval_id", true);

  await interaction.deferReply();

  try {
    const res = await fetch(`${AGENT_SERVER_URL}/api/approvals/${approvalId}/resolve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "approved",
        decision: `Approved by ${interaction.user.username} via Discord`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Approval failed: ${res.status} ${errText}`);
    }

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setDescription(`Approval \`${approvalId}\` approved.`);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, approvalId }, "approve command failed");
    await interaction.editReply({ content: `Failed to approve: ${approvalId}` });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
