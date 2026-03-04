import {
  type Interaction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("interaction-handler");

const AGENT_SERVER_URL = optionalEnv(
  "AGENT_SERVER_URL",
  "http://localhost:3100"
);

// In-memory conversation tracking per Discord channel
const channelConversations = new Map<string, string>();

interface AgentResponse {
  conversationId: string;
  agentRole: string;
  response: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function handleInteraction(
  interaction: Interaction
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "ask":
      return handleAsk(interaction);
    case "status":
      return handleStatus(interaction);
    default:
      logger.warn({ command: interaction.commandName }, "unknown command");
  }
}

async function handleAsk(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const message = interaction.options.getString("message", true);
  const channelId = interaction.channelId;

  // Defer reply since the API call may take a few seconds
  await interaction.deferReply();

  try {
    const payload: Record<string, unknown> = { message };

    // Attach conversation ID if we have one for this channel
    const existingConvId = channelConversations.get(channelId);
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

    // Track conversation for this channel
    channelConversations.set(channelId, data.conversationId);

    // Build a nice embed
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed) // purple
      .setDescription(truncate(data.response, 4096))
      .setFooter({
        text: [
          `Agent: ${data.agentRole}`,
          data.model ? `Model: ${data.model}` : null,
          data.usage
            ? `Tokens: ${data.usage.inputTokens}→${data.usage.outputTokens}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, channelId }, "ask command failed");
    await interaction.editReply({
      content:
        "⚠️ Something went wrong talking to the AI Cofounder. Is the agent server running?",
    });
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
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
      .setColor(0x22c55e) // green
      .setTitle("AI Cofounder — System Status")
      .addFields(
        { name: "Status", value: `✅ ${data.status}`, inline: true },
        {
          name: "Uptime",
          value: `${uptimeMinutes}m`,
          inline: true,
        },
        { name: "Server", value: AGENT_SERVER_URL, inline: true }
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "status command failed");
    await interaction.editReply({
      content: `⚠️ Agent server unreachable at ${AGENT_SERVER_URL}`,
    });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
