import { SlashCommandBuilder } from "discord.js";

export const autoplanCommand = new SlashCommandBuilder()
  .setName("autoplan")
  .setDescription("Have Jarvis generate your daily plan from active goals, tasks, and follow-ups")
  .addBooleanOption((opt) =>
    opt
      .setName("force")
      .setDescription("Overwrite existing plan for today")
      .setRequired(false),
  )
  .addBooleanOption((opt) =>
    opt
      .setName("merge")
      .setDescription("Append AI suggestions to your existing plan")
      .setRequired(false),
  );
