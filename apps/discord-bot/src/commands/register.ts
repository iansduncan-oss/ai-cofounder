import { REST, Routes } from "discord.js";
import { createLogger } from "@ai-cofounder/shared";
import { askCommand } from "./ask.js";
import { statusCommand } from "./status.js";

const logger = createLogger("discord-commands");

const commands = [askCommand.toJSON(), statusCommand.toJSON()];

export async function registerCommands(
  token: string,
  clientId: string
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);

  logger.info(
    { count: commands.length },
    "registering global slash commands"
  );

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });

  logger.info("slash commands registered");
}
