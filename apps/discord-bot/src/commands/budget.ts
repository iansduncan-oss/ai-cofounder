import { SlashCommandBuilder } from "discord.js";

export const budgetCommand = new SlashCommandBuilder()
  .setName("budget")
  .setDescription("View spend vs budget limits");
