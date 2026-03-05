import { buildServer } from "./server.js";
import { optionalEnv } from "@ai-cofounder/shared";
import { startScheduler } from "./scheduler.js";

async function main() {
  const { app, logger } = buildServer();
  const port = parseInt(optionalEnv("PORT", "3100"), 10);
  const host = optionalEnv("HOST", "0.0.0.0");

  await app.listen({ port, host });
  logger.info({ port, host }, "agent-server started");

  // Start background scheduler for proactive follow-ups
  startScheduler(app.db);
}

main().catch((err) => {
  console.error("Failed to start agent-server:", err);
  process.exit(1);
});
