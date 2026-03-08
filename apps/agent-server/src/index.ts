import path from "node:path";
import { buildServer } from "./server.js";
import { optionalEnv, requireEnv, createLogger } from "@ai-cofounder/shared";
import { runMigrations } from "@ai-cofounder/db";
import { initTracing, shutdownTracing } from "./tracing.js";

async function main() {
  // Initialize tracing before anything else (must be first)
  initTracing();
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

  // Initialize workspace service (creates workspace directory)
  await app.workspaceService.init();

  const port = parseInt(optionalEnv("PORT", "3100"), 10);
  const host = optionalEnv("HOST", "0.0.0.0");

  await app.listen({ port, host });
  logger.info({ port, host }, "agent-server started");

  // Graceful shutdown (scheduler is started inside buildServer)
  const shutdown = async () => {
    logger.info("shutting down...");
    await shutdownTracing();
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
