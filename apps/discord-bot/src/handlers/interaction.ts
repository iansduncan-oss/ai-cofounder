import { type Interaction, type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
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

const logger = createLogger("interaction-handler");

const client = new ApiClient({
  baseUrl: optionalEnv("AGENT_SERVER_URL", "http://localhost:3100"),
  apiSecret: process.env.API_SECRET || undefined,
});

function makeContext(interaction: ChatInputCommandInteraction): CommandContext {
  return {
    channelId: interaction.channelId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    platform: "discord",
  };
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const ctx = makeContext(interaction);

  switch (interaction.commandName) {
    case "ask": {
      const message = interaction.options.getString("message", true);
      await interaction.deferReply();
      const result = await handleAsk(client, ctx, message);
      await sendDiscordResponse(interaction, result);
      return;
    }
    case "status":
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleStatus(client));
      return;
    case "goals":
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleGoals(client, ctx));
      return;
    case "tasks":
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleTasks(client));
      return;
    case "memory":
      await interaction.deferReply({ ephemeral: true });
      await sendDiscordResponse(interaction, await handleMemory(client, ctx));
      return;
    case "clear":
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleClear(client, ctx));
      return;
    case "execute": {
      const goalId = interaction.options.getString("goal_id", true);
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleExecute(client, ctx, goalId));
      return;
    }
    case "approve": {
      const approvalId = interaction.options.getString("approval_id", true);
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleApprove(client, ctx, approvalId));
      return;
    }
    default:
      logger.warn({ command: interaction.commandName }, "unknown command");
  }
}

async function sendDiscordResponse(
  interaction: ChatInputCommandInteraction,
  result: HandlerResult,
): Promise<void> {
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

      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setDescription(truncate(result.data.response, 4096))
        .setFooter({ text: footer });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "status": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("AI Cofounder — System Status")
        .addFields(
          { name: "Status", value: result.data.status, inline: true },
          { name: "Uptime", value: `${result.data.uptimeMinutes}m`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "goals": {
      const lines = result.data.goals.map(
        (g) => `${g.icon} **${g.title}** (${g.priority})`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("Goals")
        .setDescription(lines.join("\n"));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "tasks": {
      const lines = result.data.tasks.map(
        (t) => `• **${t.title}** → ${t.assignedAgent}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("Pending Tasks")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `${result.data.totalCount} pending task(s)` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "memory": {
      const sections = result.data.sections.map(
        (s) =>
          `**${s.category}**\n${s.items.map((i) => `**${i.key}**: ${i.content}`).join("\n")}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("Memories")
        .setDescription(truncate(sections.join("\n\n"), 4096))
        .setFooter({ text: `${result.data.totalCount} memory(s)` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "clear": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setDescription("Conversation cleared. Next `/ask` starts fresh.");
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "execute": {
      const taskLines = result.data.tasks.map(
        (t) => `${t.icon} **${t.title}** (${t.agent}) — ${t.status}`,
      );
      const color =
        result.data.status === "completed"
          ? 0x22c55e
          : result.data.status === "failed"
            ? 0xef4444
            : 0x7c3aed;
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`Executing: ${result.data.goalTitle}`)
        .setDescription(taskLines.join("\n"))
        .setFooter({
          text: `${result.data.completedTasks}/${result.data.totalTasks} tasks completed · Status: ${result.data.status}`,
        });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "approve": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setDescription(`Approval \`${result.data.approvalId}\` approved.`);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "info":
      await interaction.editReply({ content: result.message });
      return;

    case "error":
      await interaction.editReply({ content: result.message });
      return;
  }
}
