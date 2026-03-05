import { SlashCommandBuilder } from "discord.js";

export const executeCommand = new SlashCommandBuilder()
  .setName("execute")
  .setDescription("Execute all tasks for a goal")
  .addStringOption((opt) =>
    opt.setName("goal_id").setDescription("The goal ID to execute").setRequired(true),
  );
