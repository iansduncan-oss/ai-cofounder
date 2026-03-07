import { SlashCommandBuilder } from "discord.js";

export const scheduleCommand = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Manage scheduled tasks")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all active schedules"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Create a new schedule")
      .addStringOption((opt) =>
        opt.setName("cron").setDescription("Cron expression (e.g. '0 9 * * 1-5')").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("task").setDescription("What the AI should do when triggered").setRequired(true),
      ),
  );
