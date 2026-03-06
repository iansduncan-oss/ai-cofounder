import { App } from "@slack/bolt";
import { createLogger, requireEnv, optionalEnv } from "@ai-cofounder/shared";
import { registerCommands } from "./commands.js";

const logger = createLogger("slack-bot");

const app = new App({
  token: requireEnv("SLACK_BOT_TOKEN"),
  signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
  appToken: requireEnv("SLACK_APP_TOKEN"),
  socketMode: true,
});

registerCommands(app);

const port = Number(optionalEnv("SLACK_BOT_PORT", "3200"));

await app.start(port);
logger.info({ port }, "Slack bot is online (Socket Mode)");
