import http from "node:http";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { createLogger, requireEnv, optionalEnv } from "@ai-cofounder/shared";
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

  // Health check HTTP server
  const healthPort = Number(optionalEnv("DISCORD_HEALTH_PORT", "3101"));
  const healthServer = http.createServer((_req, res) => {
    if (_req.url === "/health" && _req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        bot: "discord",
        uptime: process.uptime(),
        connected: client.isReady(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  healthServer.listen(healthPort, () => {
    logger.info({ port: healthPort }, "Discord bot health check server started");
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
