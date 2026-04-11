import { SlashCommandBuilder } from "discord.js";

export const auditCommand = new SlashCommandBuilder()
  .setName("audit")
  .setDescription("Scan the codebase for things to fix, improve, or add, and show top findings");
