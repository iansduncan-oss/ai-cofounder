import { SlashCommandBuilder } from "discord.js";

export const followupsCommand = new SlashCommandBuilder()
  .setName("followups")
  .setDescription("List follow-up action items")
  .addStringOption((opt) =>
    opt
      .setName("status")
      .setDescription("Filter by status")
      .setRequired(false)
      .addChoices(
        { name: "Pending", value: "pending" },
        { name: "Done", value: "done" },
        { name: "Dismissed", value: "dismissed" },
      ),
  );
