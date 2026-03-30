import { SlashCommandBuilder } from "discord.js";

export const registerUserCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register yourself with AI Cofounder");
