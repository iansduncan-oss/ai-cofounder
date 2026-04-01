import { SlashCommandBuilder } from "discord.js";

export const errorsCommand = new SlashCommandBuilder()
  .setName("errors")
  .setDescription("Show error summary for the past N hours")
  .addIntegerOption((opt) =>
    opt.setName("hours").setDescription("Hours to look back (default 24)").setRequired(false),
  );
