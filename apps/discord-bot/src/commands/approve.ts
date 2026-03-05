import { SlashCommandBuilder } from "discord.js";

export const approveCommand = new SlashCommandBuilder()
  .setName("approve")
  .setDescription("Approve a pending action")
  .addStringOption((opt) =>
    opt.setName("approval_id").setDescription("The approval ID to approve").setRequired(true),
  );
