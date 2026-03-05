import { SlashCommandBuilder } from "discord.js";

export const goalsCommand = new SlashCommandBuilder()
  .setName("goals")
  .setDescription("Show active goals for this channel");
