import fp from "fastify-plugin";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  getRedisConnection,
  startWorkers,
  stopWorkers,
  setupRecurringJobs,
  closeAllQueues,
  type WorkerProcessors,
} from "@ai-cofounder/queue";

const logger = createLogger("queue-plugin");

export const queuePlugin = fp(async (app) => {
  const redisUrl = optionalEnv("REDIS_URL", "");
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — queue system disabled");
    return;
  }

  // Initialize connection config (BullMQ connects lazily)
  getRedisConnection(redisUrl);
  logger.info("Queue system initialized");

  // NOTE: agentTask processor is NOT registered here.
  // Agent task processing is handled exclusively by the worker process (worker.ts).
  // This prevents the HTTP server from blocking on long-running agent tasks.
  const processors: WorkerProcessors = {
    // agentTask: intentionally omitted — handled by worker.ts
    monitoring: async (job) => {
      const { check } = job.data;
      logger.info({ check, jobId: job.id }, "Running monitoring check");

      switch (check) {
        case "github_ci":
          await app.monitoringService.checkGitHubCI();
          break;
        case "github_prs":
          await app.monitoringService.checkGitHubPRs();
          break;
        case "vps_health":
        case "vps_containers":
          await app.monitoringService.checkVPSHealth();
          break;
        default:
          // Full check for custom/unknown
          await app.monitoringService.runFullCheck();
      }
    },

    notification: async (job) => {
      const { title, message } = job.data;
      await app.notificationService.sendBriefing(`**${title}**\n${message}`);
      logger.info({ jobId: job.id, type: job.data.type }, "Notification delivered");
    },

    briefing: async (job) => {
      const { type } = job.data;
      logger.info({ jobId: job.id, type }, "Generating briefing");
      const { sendDailyBriefing } = await import("../services/briefing.js");
      await sendDailyBriefing(app.db, app.notificationService, app.llmRegistry);
    },

    pipeline: async (job) => {
      logger.info({ jobId: job.id, pipelineId: job.data.pipelineId }, "Executing pipeline");
      const { PipelineExecutor } = await import("../services/pipeline.js");
      const executor = new PipelineExecutor(
        app.llmRegistry,
        app.db,
        app.notificationService,
        app.embeddingService,
        app.sandboxService,
      );
      await executor.execute(job.data);
    },
  };

  startWorkers(processors);

  // Set up recurring monitoring & briefing jobs
  await setupRecurringJobs({
    briefingHour: Number(optionalEnv("BRIEFING_HOUR", "9")),
    briefingTimezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
    monitoringIntervalMinutes: 5,
  });

  // Shutdown cleanup
  app.addHook("onClose", async () => {
    await stopWorkers();
    await closeAllQueues();
    logger.info("Queue system shut down");
  });
});
