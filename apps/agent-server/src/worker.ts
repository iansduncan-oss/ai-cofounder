// apps/agent-server/src/worker.ts
// Standalone worker process — same Docker image, different CMD
// Processes agent-task jobs from the BullMQ queue

import path from "node:path";
import { createLogger, requireEnv, optionalEnv } from "@ai-cofounder/shared";
import { createDb, runMigrations } from "@ai-cofounder/db";
import {
  getRedisConnection,
  startWorkers,
  stopWorkers,
  closeAllQueues,
  RedisPubSub,
} from "@ai-cofounder/queue";
import { createLlmRegistry } from "./server.js";
import { TaskDispatcher } from "./agents/dispatcher.js";
import { VerificationService } from "./services/verification.js";
import { createEmbeddingService } from "@ai-cofounder/llm";
import { createSandboxService } from "@ai-cofounder/sandbox";
import { createWorkspaceService } from "./services/workspace.js";
import { createNotificationService } from "./services/notifications.js";

const logger = createLogger("worker");

export async function main() {
  logger.info("Worker starting...");

  // Initialize Redis connection
  const redisUrl = requireEnv("REDIS_URL");
  const redisConnection = getRedisConnection(redisUrl);
  const redisPubSub = new RedisPubSub(redisConnection);

  // Initialize database (with migrations)
  const databaseUrl = requireEnv("DATABASE_URL");
  const migrationsFolder = path.resolve(
    require.resolve("@ai-cofounder/db/package.json"),
    "..",
    "drizzle",
  );
  await runMigrations(databaseUrl, migrationsFolder);
  const db = createDb(databaseUrl);

  // Bootstrap services (same as server.ts but no Fastify)
  const llmRegistry = createLlmRegistry();
  const geminiKey = optionalEnv("GEMINI_API_KEY", "");
  const embeddingService = geminiKey ? createEmbeddingService(geminiKey) : undefined;
  const sandboxService = createSandboxService();
  const workspaceService = createWorkspaceService();
  const notificationService = createNotificationService();

  const verificationService = new VerificationService(
    llmRegistry,
    db,
    notificationService,
    workspaceService,
    sandboxService,
  );

  const dispatcher = new TaskDispatcher(
    llmRegistry,
    db,
    embeddingService,
    sandboxService,
    notificationService,
    workspaceService,
    verificationService,
  );

  // NOTE: agentTask processor is registered here exclusively.
  // Monitoring/briefing/notification/pipeline processors stay in the HTTP server (queue plugin).
  // This prevents the HTTP server from blocking on long-running agent tasks.
  startWorkers({
    // agentTask is intentionally the ONLY processor registered in this worker process
    agentTask: async (job) => {
      const { goalId, userId } = job.data;
      logger.info({ jobId: job.id, goalId, userId }, "Processing agent task");

      // Publish job_started lifecycle event before execution begins
      await redisPubSub.publish(goalId, { goalId, type: "job_started", timestamp: Date.now() });

      try {
        await dispatcher.runGoal(goalId, userId, async (event) => {
          // Publish task-level progress events as they occur
          await redisPubSub.publish(goalId, { ...event, timestamp: Date.now() });
        });

        logger.info({ jobId: job.id, goalId }, "Agent task completed");

        // Publish job_completed lifecycle event after successful execution
        await redisPubSub.publish(goalId, { goalId, type: "job_completed", timestamp: Date.now() });
      } catch (err) {
        logger.error({ jobId: job.id, goalId, err }, "Agent task failed");

        // Publish job_failed lifecycle event before re-throwing
        await redisPubSub.publish(goalId, {
          goalId,
          type: "job_failed",
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });

        throw err; // Re-throw so BullMQ marks job as failed and handles retries
      }
    },
  });

  logger.info("Worker started — waiting for jobs");

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received — draining active jobs...");
    await stopWorkers();     // waits for active job to finish
    await closeAllQueues();  // close queue connections
    await redisPubSub.close(); // close publisher connection
    logger.info("Worker shut down cleanly");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
