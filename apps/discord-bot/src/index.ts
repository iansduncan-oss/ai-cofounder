import { Client, GatewayIntentBits, Events } from "discord.js";
import { createLogger, requireEnv } from "@ai-cofounder/shared";
import { registerCommands } from "./commands/register.js";
import { handleInteraction } from "./handlers/interaction.js";

const logger = createLogger("discord-bot");

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const clientId = requireEnv("DISCORD_CLIENT_ID");

  // Deploy slash commands to Discord API
  await registerCommands(token, clientId);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info({ user: c.user.tag }, "Discord bot online");
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => {
      logger.error({ err }, "unhandled interaction error");
    });
  });

  await client.login(token);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
