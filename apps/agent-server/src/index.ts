import path from "node:path";
import { buildServer } from "./server.js";
import { optionalEnv, requireEnv, createLogger } from "@ai-cofounder/shared";
import { runMigrations } from "@ai-cofounder/db";
import { startScheduler } from "./scheduler.js";

async function main() {
  const startupLogger = createLogger("startup");

  // Run pending database migrations before starting the server
  try {
    const dbUrl = requireEnv("DATABASE_URL");
    // Resolve drizzle migrations folder relative to the db package dist/
    const migrationsFolder = path.resolve(
      require.resolve("@ai-cofounder/db/package.json"),
      "..",
      "drizzle",
    );
    startupLogger.info({ migrationsFolder }, "running database migrations...");
    await runMigrations(dbUrl, migrationsFolder);
    startupLogger.info("database migrations complete");
  } catch (err) {
    startupLogger.error({ err }, "database migration failed");
    throw err;
  }

  const { app, logger } = buildServer();

  // Initialize sandbox service (checks Docker availability)
  await app.sandboxService.init();

  const port = parseInt(optionalEnv("PORT", "3100"), 10);
  const host = optionalEnv("HOST", "0.0.0.0");

  await app.listen({ port, host });
  logger.info({ port, host }, "agent-server started");

  // Start background scheduler for proactive follow-ups
  const scheduler = startScheduler(app.db, app.llmRegistry, app.embeddingService, app.sandboxService);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("shutting down...");
    scheduler?.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Failed to start agent-server:", err);
  process.exit(1);
});
