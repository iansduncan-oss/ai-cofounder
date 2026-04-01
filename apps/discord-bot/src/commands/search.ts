import { SlashCommandBuilder } from "discord.js";

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search across goals, tasks, conversations, and memories")
  .addStringOption((opt) =>
    opt.setName("query").setDescription("Search query").setRequired(true),
  );
