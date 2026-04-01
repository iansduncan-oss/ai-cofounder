import { SlashCommandBuilder } from "discord.js";

export const approvalsCommand = new SlashCommandBuilder()
  .setName("approvals")
  .setDescription("List pending approvals");
