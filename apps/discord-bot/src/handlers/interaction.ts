import { type Interaction, type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { ApiClient } from "@ai-cofounder/api-client";
import {
  handleAskStreaming,
  handleStatus,
  handleGoals,
  handleTasks,
  handleMemory,
  handleClear,
  handleExecuteStreaming,
  handleApprove,
  handleHelp,
  handleRegister,
  handleScheduleList,
  handleScheduleCreate,
  handleGmailInbox,
  handleGmailSend,
  checkCooldown,
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
  const commandName = interaction.commandName;

  // Cooldown check (skip for help — it's free)
  if (commandName !== "help") {
    const remaining = checkCooldown(ctx.userId, commandName);
    if (remaining !== null) {
      await interaction.reply({
        content: `Please wait ${remaining} second${remaining !== 1 ? "s" : ""} before using \`/${commandName}\` again.`,
        ephemeral: true,
      });
      return;
    }
  }

  switch (commandName) {
    case "ask": {
      const message = interaction.options.getString("message", true);
      await interaction.deferReply();

      let lastEditTime = 0;
      const THROTTLE_MS = 1500;

      const result = await handleAskStreaming(client, ctx, message, async (text) => {
        const now = Date.now();
        if (now - lastEditTime >= THROTTLE_MS) {
          lastEditTime = now;
          try {
            await interaction.editReply({ content: truncate(text, 2000) });
          } catch {
            /* edit failures during streaming are non-fatal */
          }
        }
      });

      // Create a thread from the reply for longer conversations
      const reply = await interaction.fetchReply();
      try {
        await reply.startThread({
          name: truncate(message, 90),
          autoArchiveDuration: 60,
        });
      } catch {
        /* Thread creation is best-effort — may fail in threads or DMs */
      }

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
      let lastUpdate = 0;
      const result = await handleExecuteStreaming(client, ctx, goalId, async (text) => {
        const now = Date.now();
        if (now - lastUpdate > 2000) { // throttle to every 2s
          lastUpdate = now;
          try { await interaction.editReply({ content: truncate(text, 2000) }); } catch { /* non-fatal */ }
        }
      });
      await sendDiscordResponse(interaction, result);
      return;
    }
    case "approve": {
      const approvalId = interaction.options.getString("approval_id", true);
      await interaction.deferReply();
      await sendDiscordResponse(interaction, await handleApprove(client, ctx, approvalId));
      return;
    }
    case "help": {
      await interaction.deferReply({ ephemeral: true });
      await sendDiscordResponse(interaction, handleHelp());
      return;
    }
    case "register": {
      await interaction.deferReply({ ephemeral: true });
      await sendDiscordResponse(interaction, await handleRegister(client, ctx));
      return;
    }
    case "schedule": {
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply();

      if (sub === "list") {
        await sendDiscordResponse(interaction, await handleScheduleList(client));
      } else if (sub === "create") {
        const cron = interaction.options.getString("cron", true);
        const task = interaction.options.getString("task", true);
        await sendDiscordResponse(
          interaction,
          await handleScheduleCreate(client, cron, task, ctx.userId),
        );
      }
      return;
    }
    case "gmail": {
      const sub = interaction.options.getSubcommand();
      await interaction.deferReply();

      if (sub === "inbox") {
        await sendDiscordResponse(interaction, await handleGmailInbox(client));
      } else if (sub === "send") {
        const to = interaction.options.getString("to", true);
        const subject = interaction.options.getString("subject", true);
        const body = interaction.options.getString("body", true);
        await sendDiscordResponse(interaction, await handleGmailSend(client, { to, subject, body }));
      }
      return;
    }
    default:
      logger.warn({ command: commandName }, "unknown command");
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
          ? `Tokens: ${result.data.usage.inputTokens}\u2192${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" \u00b7 ");

      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setDescription(truncate(result.data.response, 4096))
        .setFooter({ text: footer });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "ask_streaming": {
      const streamFooter = [
        `Agent: ${result.data.agentRole}`,
        result.data.model ? `Model: ${result.data.model}` : null,
        result.data.usage
          ? `Tokens: ${result.data.usage.inputTokens}\u2192${result.data.usage.outputTokens}`
          : null,
      ]
        .filter(Boolean)
        .join(" \u00b7 ");

      const streamEmbed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setDescription(truncate(result.data.response, 4096))
        .setFooter({ text: streamFooter });
      await interaction.editReply({ content: "", embeds: [streamEmbed] });
      return;
    }

    case "status": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("AI Cofounder \u2014 System Status")
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
        (t) => `\u2022 **${t.title}** \u2192 ${t.assignedAgent}`,
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
        (t) => `${t.icon} **${t.title}** (${t.agent}) \u2014 ${t.status}`,
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
          text: `${result.data.completedTasks}/${result.data.totalTasks} tasks completed \u00b7 Status: ${result.data.status}`,
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

    case "help": {
      const lines = result.data.commands.map(
        (c) => `**${c.name}** \u2014 ${c.description}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("AI Cofounder \u2014 Commands")
        .setDescription(lines.join("\n"));
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "schedule_list": {
      const lines = result.data.schedules.map(
        (s) => `${s.enabled ? "\u2705" : "\u23f8\ufe0f"} \`${s.cronExpression}\` \u2014 ${s.description ?? "No description"}\n  Next: ${s.nextRunAt}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle("Schedules")
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `${result.data.totalCount} schedule(s)` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "schedule_create": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle("Schedule Created")
        .setDescription(`\`${result.data.cronExpression}\` \u2014 ${result.data.description ?? "No description"}`)
        .setFooter({ text: `ID: ${result.data.id}` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "gmail_inbox": {
      const lines = result.data.messages.map(
        (m) => `${m.isUnread ? "**" : ""}${m.from}: ${m.subject}${m.isUnread ? "**" : ""} — ${m.date}`,
      );
      const embed = new EmbedBuilder()
        .setColor(0xea4335)
        .setTitle("Gmail Inbox")
        .setDescription(truncate(lines.join("\n"), 4096))
        .setFooter({ text: `${result.data.unreadCount} unread` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "gmail_send": {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setDescription(`Email sent to **${result.data.to}**: ${result.data.subject}`);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case "register": {
      const msg = result.data.isNew
        ? `Welcome, **${result.data.displayName ?? "friend"}**! You're now registered with AI Cofounder.`
        : `You're already registered, **${result.data.displayName ?? "friend"}**!`;
      const regEmbed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setDescription(msg);
      await interaction.editReply({ embeds: [regEmbed] });
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
