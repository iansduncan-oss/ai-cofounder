import { SlashCommandBuilder } from "discord.js";

export const rejectCommand = new SlashCommandBuilder()
  .setName("reject")
  .setDescription("Reject a pending approval")
  .addStringOption((opt) =>
    opt.setName("approval_id").setDescription("The approval ID to reject").setRequired(true),
  );
