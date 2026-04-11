import { SlashCommandBuilder } from "discord.js";

export const nextCommand = new SlashCommandBuilder()
  .setName("next")
  .setDescription("Show the next task on today's plan (auto-replans if empty)");
