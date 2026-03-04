import { SlashCommandBuilder } from "discord.js";

export const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Check the AI Cofounder system status");
