import { SlashCommandBuilder } from "discord.js";

export const memoryCommand = new SlashCommandBuilder()
  .setName("memory")
  .setDescription("Show what the AI Co-Founder remembers about you");
