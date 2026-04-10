import { SlashCommandBuilder } from "discord.js";

export const planCommand = new SlashCommandBuilder()
  .setName("plan")
  .setDescription("Log your productivity plan for today")
  .addStringOption((opt) =>
    opt
      .setName("tasks")
      .setDescription("Tasks for today (comma-separated)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("mood")
      .setDescription("How are you feeling?")
      .setRequired(false)
      .addChoices(
        { name: "Great", value: "great" },
        { name: "Good", value: "good" },
        { name: "Okay", value: "okay" },
        { name: "Rough", value: "rough" },
        { name: "Terrible", value: "terrible" },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("energy")
      .setDescription("Energy level (1-5)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(5),
  );
