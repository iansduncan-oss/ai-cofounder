import { SlashCommandBuilder } from "discord.js";

export const askCommand = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the AI Cofounder a question")
  .addStringOption((opt) =>
    opt.setName("message").setDescription("Your question or request").setRequired(true),
  );
