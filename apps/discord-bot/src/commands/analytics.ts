import { SlashCommandBuilder } from "discord.js";

export const analyticsCommand = new SlashCommandBuilder()
  .setName("analytics")
  .setDescription("View goal completion analytics and agent performance");
