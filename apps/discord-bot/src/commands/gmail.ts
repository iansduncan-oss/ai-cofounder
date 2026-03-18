import { SlashCommandBuilder } from "discord.js";

export const gmailCommand = new SlashCommandBuilder()
  .setName("gmail")
  .setDescription("Gmail integration")
  .addSubcommand((sub) =>
    sub.setName("inbox").setDescription("Show recent inbox messages"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("send")
      .setDescription("Send an email")
      .addStringOption((opt) =>
        opt.setName("to").setDescription("Recipient email address").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("subject").setDescription("Email subject").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("body").setDescription("Email body").setRequired(true),
      ),
  );
