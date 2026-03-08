import http from "node:http";
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

// Health check HTTP server
const healthPort = Number(optionalEnv("SLACK_HEALTH_PORT", "3102"));
let slackConnected = true; // Socket Mode connection is established by app.start()

const healthServer = http.createServer((_req, res) => {
  if (_req.url === "/health" && _req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      bot: "slack",
      uptime: process.uptime(),
      connected: slackConnected,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(healthPort, () => {
  logger.info({ port: healthPort }, "Slack bot health check server started");
});
