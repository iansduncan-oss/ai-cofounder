import { SlashCommandBuilder } from "discord.js";

export const standupCommand = new SlashCommandBuilder()
  .setName("standup")
  .setDescription("Get daily standup narrative and metrics")
  .addStringOption((opt) =>
    opt.setName("date").setDescription("Date in YYYY-MM-DD format (defaults to today)").setRequired(false),
  );
