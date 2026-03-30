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
import { SubagentRunner } from "./services/subagent.js";
import { AgentMessagingService } from "./services/agent-messaging.js";
import { DistributedLockService } from "./services/distributed-lock.js";
import { PlanRepairService } from "./services/plan-repair.js";
import { createDiscordService } from "./services/discord.js";
import { createVpsCommandService } from "./services/vps-command.js";
import { ProceduralMemoryService } from "./services/procedural-memory.js";
import Redis from "ioredis";

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
  const discordService = createDiscordService();
  const vpsCommandService = createVpsCommandService();
  const notificationService = createNotificationService();

  const verificationService = new VerificationService(
    llmRegistry,
    db,
    notificationService,
    workspaceService,
    sandboxService,
  );

  const planRepairService = new PlanRepairService(llmRegistry);
  const embedFn = embeddingService ? (text: string) => embeddingService.embed(text) : undefined;
  const proceduralMemoryService = embedFn ? new ProceduralMemoryService(db, llmRegistry, embedFn) : undefined;

  const dispatcher = new TaskDispatcher(
    llmRegistry,
    db,
    embeddingService,
    sandboxService,
    notificationService,
    workspaceService,
    verificationService,
    planRepairService,
    proceduralMemoryService,
  );

  // Agent messaging service
  const messagingService = new AgentMessagingService(db, redisPubSub);

  // Distributed lock service for autonomous session exclusion
  const lockRedis = new Redis(redisUrl);
  const lockService = new DistributedLockService(lockRedis);

  // Subagent runner for autonomous subagent tasks
  const subagentRunner = new SubagentRunner(
    llmRegistry,
    db,
    embeddingService,
    undefined, // n8nService — not available in worker
    sandboxService,
    workspaceService,
    redisPubSub,
    messagingService,
  );

  // NOTE: agentTask + subagentTask processors are registered here exclusively.
  // Monitoring/briefing/notification/pipeline processors stay in the HTTP server (queue plugin).
  startWorkers({
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

    subagentTask: async (job) => {
      const { subagentRunId, title } = job.data;
      logger.info({ jobId: job.id, subagentRunId, title }, "Processing subagent task");
      await subagentRunner.run(job.data);
      logger.info({ jobId: job.id, subagentRunId }, "Subagent task completed");
    },

    autonomousSession: async (job) => {
      const { trigger, tokenBudget, timeBudgetMs, prompt } = job.data;
      logger.info({ jobId: job.id, trigger }, "Starting autonomous session from queue");
      const { runAutonomousSession } = await import("./autonomous-session.js");
      const result = await runAutonomousSession(
        db, llmRegistry, embeddingService, sandboxService, workspaceService, messagingService,
        lockService,
        { trigger, tokenBudget, timeBudgetMs, prompt, discordService, vpsCommandService },
      );
      logger.info({ jobId: job.id, status: result.status, tokensUsed: result.tokensUsed }, "Autonomous session finished");
    },
  });

  logger.info("Worker started — waiting for jobs");

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received — draining active jobs...");
    await stopWorkers();     // waits for active job to finish
    await closeAllQueues();  // close queue connections
    await redisPubSub.close(); // close publisher connection
    await lockRedis.quit();  // close lock service Redis connection
    logger.info("Worker shut down cleanly");
    process.exit(0);
  };

  const onSigTerm = () => shutdown("SIGTERM");
  const onSigInt = () => shutdown("SIGINT");
  const onUnhandledRejection = (reason: unknown) => {
    logger.fatal({ err: reason }, "unhandled rejection — exiting");
    process.exit(1);
  };
  const onUncaughtException = (err: Error) => {
    logger.fatal({ err }, "uncaught exception — exiting");
    process.exit(1);
  };

  process.on("SIGTERM", onSigTerm);
  process.on("SIGINT", onSigInt);
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);

  // Return cleanup function for testing
  return () => {
    process.off("SIGTERM", onSigTerm);
    process.off("SIGINT", onSigInt);
    process.off("unhandledRejection", onUnhandledRejection);
    process.off("uncaughtException", onUncaughtException);
  };
}

// Only auto-start when run as the entry point (not when imported for testing)
const isMainModule = process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.ts");
if (isMainModule) {
  main().catch((err) => {
    logger.error({ err }, "Worker startup failed");
    process.exit(1);
  });
}
