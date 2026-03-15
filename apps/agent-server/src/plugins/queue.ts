import fp from "fastify-plugin";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { createJournalEntry } from "@ai-cofounder/db";
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
      const check = job.data.check as string;
      logger.info({ check, jobId: job.id }, "Running monitoring check");

      switch (check) {
        case "github_ci": {
          const ciResults = await app.monitoringService.checkGitHubCI();
          // Feed CI results to self-heal service for failure tracking (SCHED-04)
          if (app.ciSelfHealService) {
            for (const ci of ciResults) {
              if (ci.status === "failure") {
                await app.ciSelfHealService.recordFailure(ci.repo, ci.branch, ci.url);
              } else if (ci.status === "success") {
                await app.ciSelfHealService.recordSuccess(ci.repo, ci.branch);
              }
            }
          }
          break;
        }
        case "github_prs":
          await app.monitoringService.checkGitHubPRs();
          break;
        case "vps_health":
        case "vps_containers":
          await app.monitoringService.checkVPSHealth();
          break;
        case "soak_check": {
          // Check deployments in soak period
          const { getLatestDeployment, updateDeploymentStatus } = await import("@ai-cofounder/db");
          const latest = await getLatestDeployment(app.db);
          if (latest?.soakStatus === "soaking" && latest.soakStartedAt) {
            const soakAge = Date.now() - new Date(latest.soakStartedAt).getTime();
            const SOAK_DURATION = 10 * 60 * 1000; // 10 minutes
            if (soakAge >= SOAK_DURATION) {
              await updateDeploymentStatus(app.db, latest.id, {
                status: "healthy",
                completedAt: new Date(),
              });
              logger.info({ deploymentId: latest.id }, "soak period completed successfully");
            }
          }
          break;
        }
        case "approval_timeout_sweep": {
          const { listExpiredPendingApprovals, resolveApproval } = await import("@ai-cofounder/db");
          const expired = await listExpiredPendingApprovals(app.db);
          for (const approval of expired) {
            await resolveApproval(app.db, approval.id, "rejected", "Auto-denied: approval timeout exceeded");
          }
          if (expired.length > 0) {
            logger.info({ count: expired.length }, "Auto-denied expired pending approvals");
          }
          break;
        }
        case "budget_check": {
          if (app.budgetAlertService) {
            await app.budgetAlertService.checkBudgets();
          }
          break;
        }
        case "dlq_check": {
          const { listDeadLetterJobs } = await import("@ai-cofounder/queue");
          const dlqJobs = await listDeadLetterJobs(10);
          const threshold = Number(optionalEnv("DLQ_ALERT_THRESHOLD", "3"));
          if (dlqJobs.length >= threshold) {
            await app.notificationService.notifyDlqAlert(dlqJobs.length, dlqJobs);
            logger.warn({ count: dlqJobs.length }, "DLQ threshold exceeded — alert sent");
          }
          break;
        }
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
        app.journalService,   // journal integration
        app.n8nService,       // n8n post-pipeline trigger
      );
      await executor.execute(job.data);
    },

    reflection: async (job) => {
      const { action } = job.data;
      logger.info({ jobId: job.id, action }, "Processing reflection job");
      const { ReflectionService } = await import("../services/reflection.js");
      const reflectionService = new ReflectionService(
        app.db,
        app.llmRegistry,
        app.embeddingService,
      );

      switch (action) {
        case "analyze_goal": {
          const { goalId, goalTitle, status, taskResults } = job.data;
          if (goalId && goalTitle && status && taskResults) {
            await reflectionService.reflectOnGoal(goalId, goalTitle, status, taskResults);
            void createJournalEntry(app.db, {
              entryType: "reflection",
              title: `Reflection: ${goalTitle}`,
              summary: `${status} goal analyzed`,
              goalId,
              details: { status, taskCount: taskResults.length },
            }).catch((err) => logger.warn({ err }, "journal write failed"));
          }
          break;
        }
        case "weekly_patterns":
          await reflectionService.extractWeeklyPatterns();
          break;
        case "analyze_user_patterns":
          await reflectionService.analyzeUserPatterns();
          break;
        case "extract_decision": {
          const { DecisionExtractorService } = await import("../services/decision-extractor.js");
          const svc = new DecisionExtractorService(app.db, app.llmRegistry, app.embeddingService);
          if (job.data.response && job.data.userId) {
            await svc.extractAndStore(job.data.response, job.data.userId, job.data.conversationId);
          }
          break;
        }
        case "consolidate_memories": {
          const { MemoryConsolidationService } = await import("../services/memory-consolidation.js");
          const svc = new MemoryConsolidationService(app.db, app.llmRegistry, app.embeddingService);
          const result = await svc.consolidate();
          logger.info(result, "memory consolidation complete");
          break;
        }
        case "process_pattern_feedback": {
          const { PatternFeedbackProcessor } = await import("../services/pattern-feedback.js");
          const processor = new PatternFeedbackProcessor(app.db);
          const result = await processor.processConfidenceAdjustments();
          logger.info(result, "pattern feedback processing complete");
          break;
        }
      }
    },

    deployVerification: async (job) => {
      const { deploymentId, commitSha, previousSha } = job.data;
      logger.info({ jobId: job.id, deploymentId, commitSha: commitSha?.slice(0, 7) }, "Running deploy verification");
      const { DeployHealthService } = await import("../services/deploy-health.js");
      const deployHealthService = new DeployHealthService(
        app.db,
        app.llmRegistry,
        app.notificationService,
        app.monitoringService,
      );

      if (job.name === "analyze-failure") {
        await deployHealthService.handleDeployFailure(
          deploymentId,
          commitSha,
          previousSha,
        );
        // Record failure in circuit breaker
        if (app.deployCircuitBreakerService) {
          await app.deployCircuitBreakerService.recordFailure(commitSha, job.data.errorLog).catch((err: unknown) => {
            logger.warn({ err }, "circuit breaker failure recording failed");
          });
        }
      } else {
        await deployHealthService.verifyDeployment(deploymentId, commitSha, previousSha);
      }
    },

    ragIngestion: async (job) => {
      const { action, sourceId } = job.data;
      logger.info({ jobId: job.id, action, sourceId }, "Running RAG ingestion");
      const { ingestText } = await import("@ai-cofounder/rag");
      if (!app.embeddingService) {
        logger.warn("RAG ingestion skipped — no embedding service available");
        return;
      }
      switch (action) {
        case "ingest_conversations": {
          if (sourceId === "sweep") {
            // Sweep mode: ingest recent conversation summaries that haven't been ingested
            const { getRecentConversationSummaries } = await import("@ai-cofounder/db");
            const { needsReingestion } = await import("@ai-cofounder/rag");
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h
            const summaries = await getRecentConversationSummaries(app.db, since);
            for (const s of summaries) {
              const needs = await needsReingestion(app.db, "conversation", s.conversationId, s.id);
              if (needs) {
                await ingestText(
                  app.db,
                  app.embeddingService.embed.bind(app.embeddingService),
                  "conversation",
                  s.conversationId,
                  s.summary,
                  { cursor: s.id },
                );
              }
            }
          } else {
            // Single conversation ingestion
            const { getLatestConversationSummary } = await import("@ai-cofounder/db");
            const summary = await getLatestConversationSummary(app.db, sourceId);
            if (summary) {
              await ingestText(
                app.db,
                app.embeddingService.embed.bind(app.embeddingService),
                "conversation",
                sourceId,
                summary.summary,
                { cursor: summary.id },
              );
            }
          }
          break;
        }
        case "ingest_text": {
          const content = job.data.metadata?.content as string | undefined;
          if (content) {
            await ingestText(
              app.db,
              app.embeddingService.embed.bind(app.embeddingService),
              "markdown",
              sourceId,
              content,
              { cursor: job.data.cursor },
            );
          }
          break;
        }
        case "ingest_repo": {
          // Repo ingestion uses workspace service to read files
          if (!app.workspaceService) {
            logger.warn("RAG repo ingestion skipped — no workspace service");
            return;
          }
          const { ingestFiles, shouldSkipFile } = await import("@ai-cofounder/rag");
          const entries = await app.workspaceService.listDirectory(sourceId);
          const filePaths = entries.filter((e) => e.type === "file").map((e) => e.name);
          const fileContents = await Promise.all(
            filePaths
              .filter((f) => !shouldSkipFile(f))
              .slice(0, 500) // limit to 500 files per ingestion
              .map(async (f) => {
                try {
                  const content = await app.workspaceService!.readFile(`${sourceId}/${f}`);
                  return { path: f, content };
                } catch {
                  return null;
                }
              }),
          );
          const validFiles = fileContents.filter((f): f is { path: string; content: string } => f !== null);
          await ingestFiles(
            app.db,
            app.embeddingService!.embed.bind(app.embeddingService!),
            "git",
            sourceId,
            validFiles,
            { cursor: job.data.cursor },
          );
          break;
        }
      }
    },
  };

  startWorkers(processors);

  // Set up recurring monitoring & briefing jobs
  await setupRecurringJobs({
    briefingHour: Number(optionalEnv("BRIEFING_HOUR", "9")),
    briefingTimezone: optionalEnv("BRIEFING_TIMEZONE", "America/New_York"),
    monitoringIntervalMinutes: 5,
    autonomousSessionIntervalMinutes: Number(optionalEnv("AUTONOMOUS_SESSION_INTERVAL_MINUTES", "30")),
  });

  // Seed YouTube Shorts pipeline template (idempotent)
  setImmediate(async () => {
    try {
      const { getPipelineTemplateByName, createPipelineTemplate, getN8nWorkflowByName, createN8nWorkflow } = await import("@ai-cofounder/db");

      // Seed pipeline template
      const existing = await getPipelineTemplateByName(app.db, "youtube-shorts");
      if (!existing) {
        await createPipelineTemplate(app.db, {
          name: "youtube-shorts",
          description: "Generate a YouTube Shorts script and trigger n8n publishing workflow",
          stages: [
            { agent: "researcher", prompt: "Research trending topics and generate a YouTube Shorts script (60 seconds max). Output: title, hook, script, hashtags.", dependsOnPrevious: false },
            { agent: "reviewer", prompt: "Review the YouTube Shorts script for quality, hook strength, and SEO. Suggest improvements.", dependsOnPrevious: true },
          ],
          defaultContext: { templateName: "youtube-shorts", n8nWorkflow: "youtube-shorts-publish" },
        });
        logger.info("Seeded youtube-shorts pipeline template");
      }

      // Register YouTube Shorts n8n workflow — placeholder webhook URL
      const existingWorkflow = await getN8nWorkflowByName(app.db, "youtube-shorts-publish");
      if (!existingWorkflow) {
        const n8nBaseUrl = optionalEnv("N8N_BASE_URL", "http://localhost:5678");
        await createN8nWorkflow(app.db, {
          name: "youtube-shorts-publish",
          description: "YouTube Shorts publishing workflow — triggered after content pipeline generates script",
          webhookUrl: `${n8nBaseUrl}/webhook/youtube-shorts-publish`,
          direction: "outbound",
          inputSchema: { pipelineId: "string", goalId: "string", output: "string" },
        });
        logger.info("Registered youtube-shorts-publish n8n workflow");
      }
    } catch (err) {
      logger.warn({ err }, "Failed to seed content automation templates");
    }
  });

  // Shutdown cleanup
  app.addHook("onClose", async () => {
    await stopWorkers();
    await closeAllQueues();
    logger.info("Queue system shut down");
  });
});
