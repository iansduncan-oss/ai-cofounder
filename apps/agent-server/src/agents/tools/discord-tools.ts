import type { LlmTool } from "@ai-cofounder/llm";

export const READ_DISCORD_MESSAGES_TOOL: LlmTool = {
  name: "read_discord_messages",
  description:
    "Fetch recent messages from a Discord channel. Use this to check for errors, " +
    "requests, or context posted by team members or monitoring bots. " +
    "Use list_discord_channels first if you don't know the channel ID.",
  input_schema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "Discord channel ID to read from",
      },
      limit: {
        type: "number",
        description: "Number of messages to fetch (max 50, default 20)",
      },
    },
    required: ["channel_id"],
  },
};

export const LIST_DISCORD_CHANNELS_TOOL: LlmTool = {
  name: "list_discord_channels",
  description:
    "List text channels in the Discord server. Use this to discover channel IDs " +
    "before reading messages. Returns channel names and IDs.",
  input_schema: {
    type: "object",
    properties: {
      guild_id: {
        type: "string",
        description: "Discord server (guild) ID. Defaults to the configured DISCORD_GUILD_ID.",
      },
    },
    required: [],
  },
};
