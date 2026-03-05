import { SlashCommandBuilder } from "discord.js";

export const tasksCommand = new SlashCommandBuilder()
  .setName("tasks")
  .setDescription("Show pending tasks");
