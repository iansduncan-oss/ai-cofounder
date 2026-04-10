import { SlashCommandBuilder } from "discord.js";

export const streakCommand = new SlashCommandBuilder()
  .setName("streak")
  .setDescription("Show your current productivity streak and today's progress");
