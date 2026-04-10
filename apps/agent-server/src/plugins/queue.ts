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
import { notifyCiFailures, fireN8nActionWebhook } from "../helpers/queue-processors.js";

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

  // Cached per-plugin instance; discord-triage jobs can fire many times per
  // minute during active discussions, so we avoid re-instantiating per job.
  let cachedTriageService: import("../services/discord-triage.js").DiscordTriageService | null = null;
  let cachedBuildDiscordAlertBlocks:
    | typeof import("../services/discord-triage.js").buildDiscordAlertBlocks
    | null = null;

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

          // Notify user of CI failures via Slack
          await notifyCiFailures(app.notificationService, ciResults);
          break;
        }
        case "github_prs": {
          const prResults = await app.monitoringService.checkGitHubPRs();
          logger.debug({ openPRs: prResults.length }, "GitHub PR check complete");
          break;
        }
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
            app.agentEvents.emit("ws:approval_change");
          }
          break;
        }
        case "budget_check": {
          if (app.budgetAlertService) {
            await app.budgetAlertService.checkBudgets();
          }
          break;
        }
        case "sandbox_orphan_cleanup": {
          if (app.sandboxService?.available) {
            const cleaned = await app.sandboxService.cleanupOrphanContainers();
            if (cleaned > 0) {
              const { recordSandboxOrphanCleanup } = await import("./observability.js");
              recordSandboxOrphanCleanup(cleaned);
            }
          }
          break;
        }
        case "dlq_check": {
          const { listDeadLetterJobs, trimEventStreams } = await import("@ai-cofounder/queue");
          const dlqJobs = await listDeadLetterJobs(10);
          const threshold = Number(optionalEnv("DLQ_ALERT_THRESHOLD", "3"));
          if (dlqJobs.length >= threshold) {
            await app.notificationService.notifyDlqAlert(dlqJobs.length, dlqJobs);
            logger.warn({ count: dlqJobs.length }, "DLQ threshold exceeded — alert sent");
          }
          // Trim event streams to prevent unbounded Redis growth
          try {
            await trimEventStreams(500);
          } catch (err) {
            logger.warn({ err }, "failed to trim event streams");
          }
          break;
        }
        case "follow_up_reminders": {
          const { listDueFollowUps, markFollowUpReminderSent } = await import("@ai-cofounder/db");
          const { getNotificationQueue } = await import("@ai-cofounder/queue");
          const dueItems = await listDueFollowUps(app.db);
          const notifQueue = getNotificationQueue();
          for (const item of dueItems) {
            await notifQueue.add("follow-up-reminder", {
              channel: "all",
              type: "info",
              title: "Follow-up Due",
              message: `"${item.title}" is due${item.dueDate ? ` (was due ${new Date(item.dueDate).toLocaleDateString()})` : ""}.`,
            });
            await markFollowUpReminderSent(app.db, item.id);
          }
          if (dueItems.length > 0) {
            logger.info({ count: dueItems.length }, "Sent follow-up reminders");
          }
          break;
        }
        case "discord_hourly_digest": {
          try {
            const { DiscordDigestService } = await import("../services/discord-digest.js");
            const digestService = new DiscordDigestService();
            const items = await digestService.flush("hourly");
            if (items.length > 0) {
              const { text, blocks } = digestService.formatDigest(items);
              await app.notificationService.sendSlackPreferred(text, blocks);
              logger.info({ count: items.length }, "Discord hourly digest sent");
            }
          } catch (err) {
            logger.warn({ err }, "failed to process Discord hourly digest");
          }
          break;
        }
        case "self_healing_check": {
          if (app.selfHealingService) {
            const report = app.selfHealingService.generateReport();
            const unhealthyAgents = report.healthScores.filter((h) => h.score < 50 && (h.recentSuccesses + h.recentFailures) >= 5);
            const openBreakers = report.activeCircuitBreakers;

            const insights: string[] = [];
            for (const agent of unhealthyAgents) {
              insights.push(`Agent **${agent.agentRole}** health: ${agent.score}% (${agent.recentFailures} failures / ${agent.recentSuccesses + agent.recentFailures} recent)`);
            }
            for (const cb of openBreakers) {
              insights.push(`Circuit breaker **${cb.state.status.toUpperCase()}** for "${cb.agentRole}" (${cb.state.failureCount} failures)`);
            }
            for (const pattern of report.systematicFailures.slice(0, 3)) {
              insights.push(`Repeated failure: **${pattern.key}** occurred ${pattern.count}x in 24h — "${pattern.samples[0]?.slice(0, 100) ?? "unknown"}"`);
            }
            if (report.recommendations.length > 0 && insights.length === 0) {
              // Include recommendations only if no specific insights already captured
              for (const rec of report.recommendations.slice(0, 2)) {
                insights.push(rec);
              }
            }

            if (insights.length > 0) {
              await app.notificationService.notifySystemInsights(insights);
              logger.warn({ insights: insights.length }, "system intelligence report sent");
            }
          }
          break;
        }
        default:
          // Full check for custom/unknown
          await app.monitoringService.runFullCheck();
      }
      app.agentEvents.emit("ws:monitoring_complete");
    },

    notification: async (job) => {
      const { title, message } = job.data;
      await app.notificationService.sendBriefing(`**${title}**\n${message}`);
      logger.info({ jobId: job.id, type: job.data.type }, "Notification delivered");
      app.agentEvents.emit("ws:notification_complete");
    },

    briefing: async (job) => {
      const { type } = job.data;
      logger.info({ jobId: job.id, type }, "Generating briefing");
      const { sendDailyBriefing } = await import("../services/briefing.js");
      const { getPrimaryAdminUserId } = await import("@ai-cofounder/db");
      const adminUserId = await getPrimaryAdminUserId(app.db);
      await sendDailyBriefing(app.db, app.notificationService, app.llmRegistry, adminUserId ?? undefined, app.monitoringService);

      // Write daily vault note alongside briefing
      try {
        const { writeDailyNote, ensureVaultStructure } = await import("../services/vault.js");
        await ensureVaultStructure();
        await writeDailyNote(app.db);
      } catch (err) {
        logger.warn({ err }, "vault daily note failed (non-fatal)");
      }

      app.agentEvents.emit("ws:briefing_complete");
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
      app.agentEvents.emit("ws:pipeline_complete");
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
        case "process_pattern_feedback": {
          const { PatternFeedbackProcessor } = await import("../services/pattern-feedback.js");
          const processor = new PatternFeedbackProcessor(app.db);
          const result = await processor.processConfidenceAdjustments();
          logger.info(result, "pattern feedback processing complete");
          break;
        }
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
        case "create_episode": {
          if (app.episodicMemoryService && job.data.conversationId) {
            const episode = await app.episodicMemoryService.createEpisode(job.data.conversationId);
            if (episode) {
              logger.info({ episodeId: episode.id }, "Episodic memory created");
            }
          }
          break;
        }
        case "learn_procedure": {
          if (app.proceduralMemoryService && job.data.goalId) {
            const procedure = await app.proceduralMemoryService.learnProcedure(job.data.goalId);
            if (procedure) {
              logger.info({ procedureId: procedure.id }, "Procedural memory learned");
            }
          }
          break;
        }
        case "memory_lifecycle": {
          if (app.memoryLifecycleService && job.data.userId) {
            const result = await app.memoryLifecycleService.runFullLifecycle(job.data.userId);
            logger.info(result, "Memory lifecycle maintenance complete");
          }
          break;
        }
        case "analyze_failures": {
          if (app.failurePatternsService) {
            const hint = await app.failurePatternsService.formatPatternsForPrompt();
            logger.info({ hasPatterns: hint.length > 0 }, "Failure pattern analysis complete");
          }
          break;
        }
      }
    },

    deployVerification: async (job) => {
      const { deploymentId, commitSha, previousSha } = job.data;
      logger.info({ jobId: job.id, deploymentId, commitSha: commitSha?.slice(0, 7), jobName: job.name }, "Running deploy verification");
      const { DeployHealthService } = await import("../services/deploy-health.js");
      const deployHealthService = new DeployHealthService(
        app.db,
        app.llmRegistry,
        app.notificationService,
        app.monitoringService,
        app.deployCircuitBreakerService,
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
      } else if (job.name === "soak-check") {
        await deployHealthService.startSoakMonitoring(
          deploymentId,
          commitSha,
          previousSha,
        );
      } else {
        await deployHealthService.verifyDeployment(deploymentId, commitSha, previousSha);

        // After successful verification, enqueue soak monitoring
        try {
          const { getDeployVerificationQueue } = await import("@ai-cofounder/queue");
          await getDeployVerificationQueue().add(
            "soak-check",
            { deploymentId, commitSha, previousSha },
            { delay: 30_000 }, // 30s after initial verify
          );
          logger.info({ deploymentId }, "soak-check job enqueued");
        } catch {
          logger.debug("failed to enqueue soak-check job");
        }
      }

      // Notify dashboard via WS
      app.agentEvents.emit("ws:deploy_change");
    },

    meetingPrep: async (job) => {
      const { action } = job.data;
      logger.info({ jobId: job.id, action }, "Processing meeting prep job");
      const { MeetingPrepService } = await import("../services/meeting-prep.js");
      const { getPrimaryAdminUserId } = await import("@ai-cofounder/db");
      const svc = new MeetingPrepService(app.db, app.llmRegistry, app.embeddingService);

      if (action === "generate_upcoming") {
        const adminUserId = await getPrimaryAdminUserId(app.db);
        if (!adminUserId) {
          logger.warn("No primary admin user — skipping meeting prep generation");
          return;
        }
        await svc.generateUpcomingPreps(adminUserId);
      } else if (action === "send_notifications") {
        await svc.sendPrepNotifications(app.notificationService);
      }
    },

    discordTriage: async (job) => {
      const { channelId, channelName, messages, batchedAt } = job.data;
      logger.info({ jobId: job.id, channelName, messageCount: messages.length }, "Triaging discord batch");

      if (optionalEnv("DISCORD_WATCHER_ENABLED", "false") !== "true") {
        logger.debug("discord watcher disabled, skipping triage");
        return;
      }

      if (!cachedTriageService || !cachedBuildDiscordAlertBlocks) {
        const mod = await import("../services/discord-triage.js");
        cachedTriageService = new mod.DiscordTriageService(app.llmRegistry);
        cachedBuildDiscordAlertBlocks = mod.buildDiscordAlertBlocks;
      }
      const triageService = cachedTriageService;
      const buildDiscordAlertBlocks = cachedBuildDiscordAlertBlocks;
      const result = await triageService.triageBatch({ channelName, messages });

      const minConfidence = parseFloat(optionalEnv("DISCORD_WATCHER_MIN_CONFIDENCE", "0.6"));
      if (!result.actionable || result.confidence < minConfidence) {
        logger.debug(
          { channelName, category: result.category, confidence: result.confidence },
          "discord batch classified as non-actionable",
        );
        return;
      }

      // Deduplication: skip if we've seen a similar alert recently (6h window)
      try {
        const crypto = await import("node:crypto");
        const dedupeKey = `discord-triage-seen:${crypto.createHash("sha256")
          .update(`${channelId}:${result.category}:${result.summary.toLowerCase().slice(0, 100)}`)
          .digest("hex").slice(0, 16)}`;
        const { getDiscordTriageQueue } = await import("@ai-cofounder/queue");
        const client = await getDiscordTriageQueue().client;
        const wasNew = await client.set(dedupeKey, "1", "EX", 21600, "NX");
        if (!wasNew) {
          logger.debug({ channelName, category: result.category }, "duplicate triage result suppressed");
          return;
        }
      } catch {
        // Dedup is best-effort — continue if Redis call fails
      }

      logger.info(
        { channelName, category: result.category, urgency: result.urgency, summary: result.summary },
        "actionable discord messages detected",
      );

      // Check quiet hours — downgrade everything to daily digest
      const quietStart = optionalEnv("DISCORD_WATCHER_QUIET_START", "");
      const quietEnd = optionalEnv("DISCORD_WATCHER_QUIET_END", "");
      let effectiveUrgency = result.urgency;
      if (quietStart && quietEnd) {
        const now = new Date();
        const current = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = quietStart.split(":").map(Number);
        const [eh, em] = quietEnd.split(":").map(Number);
        const startMin = sh * 60 + (sm || 0);
        const endMin = eh * 60 + (em || 0);
        const isQuiet = startMin > endMin
          ? current >= startMin || current < endMin
          : current >= startMin && current < endMin;
        if (isQuiet && effectiveUrgency !== "high") {
          effectiveUrgency = "low";
        }
      }

      // Save to memory for Claude Code context bridge
      try {
        const { saveMemory, getPrimaryAdminUserId } = await import("@ai-cofounder/db");
        const adminUserId = await getPrimaryAdminUserId(app.db);
        if (adminUserId) {
          const relevantText = messages
            .filter((m) => result.relevantMessageIds.includes(m.messageId))
            .map((m) => `${m.authorName}: ${m.content.slice(0, 300)}`)
            .join("\n");
          const memoryContent =
            `[Discord #${channelName}] ${result.summary}\n` +
            `Category: ${result.category} | Urgency: ${result.urgency}\n` +
            (result.suggestedAction ? `Suggested: ${result.suggestedAction}\n` : "") +
            (relevantText ? `Messages:\n${relevantText}` : "");

          const embedding = app.embeddingService
            ? await app.embeddingService.embed(memoryContent.slice(0, 4000))
            : undefined;

          await saveMemory(app.db, {
            userId: adminUserId,
            category: "projects",
            key: `discord-${channelName}-${batchedAt}`,
            content: memoryContent,
            source: "discord-watcher",
            embedding,
          });
        }
      } catch (err) {
        logger.warn({ err }, "failed to save discord triage to memory");
      }

      // Tiered delivery
      if (effectiveUrgency === "high") {
        // Immediate Slack DM with rich blocks
        const blocks = buildDiscordAlertBlocks(result, channelName, messages);
        await app.notificationService.sendSlackPreferred(
          `Discord Alert: ${result.summary}`,
          blocks,
        );
        logger.info({ channelName, urgency: "high" }, "immediate Slack alert sent");
      } else {
        // Medium/low: accumulate for digest
        const bucket = effectiveUrgency === "medium" ? "hourly" : "daily";
        try {
          const { DiscordDigestService } = await import("../services/discord-digest.js");
          const digestService = new DiscordDigestService();
          await digestService.accumulate(bucket, {
            channelName,
            summary: result.summary,
            category: result.category,
            suggestedAction: result.suggestedAction,
            urgency: result.urgency,
            timestamp: batchedAt,
          });
          logger.info({ channelName, urgency: effectiveUrgency, bucket }, "triage item accumulated for digest");
        } catch (err) {
          // Fallback: if digest service unavailable, send immediately
          logger.warn({ err }, "digest accumulation failed, sending immediately");
          const blocks = buildDiscordAlertBlocks(result, channelName, messages);
          await app.notificationService.sendSlackPreferred(
            `Discord: ${result.summary}`,
            blocks,
          );
        }
      }

      // Trigger n8n webhook if a mapping exists for this category
      await fireN8nActionWebhook({ result, messages, channelName, batchedAt });
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
