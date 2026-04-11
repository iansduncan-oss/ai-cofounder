import { SlashCommandBuilder } from "discord.js";

export const reflectCommand = new SlashCommandBuilder()
  .setName("reflect")
  .setDescription("Log an end-of-day reflection on today's productivity")
  .addStringOption((opt) =>
    opt
      .setName("highlights")
      .setDescription("What went well today?")
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("blockers")
      .setDescription("What was challenging or blocking?")
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("notes")
      .setDescription("Any other thoughts")
      .setRequired(false),
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
  );
