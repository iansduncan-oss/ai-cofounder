import { SlashCommandBuilder } from "discord.js";

export const clearCommand = new SlashCommandBuilder()
  .setName("clear")
  .setDescription("Start a fresh conversation in this channel");
