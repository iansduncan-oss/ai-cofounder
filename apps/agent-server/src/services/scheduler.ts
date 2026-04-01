import { CronExpressionParser } from "cron-parser";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  listDueSchedules,
  updateScheduleLastRun,
  createWorkSession,
  completeWorkSession,
  createConversation,
  findOrCreateUser,
  decayAllMemoryImportance,
  getTodayTokenTotal,
  listPendingApprovals,
  listActiveGoals,
  getLatestUserMessageTime,
  createJournalEntry,
} from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import { Orchestrator } from "../agents/orchestrator.js";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { N8nService } from "./n8n.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./workspace.js";
import { sendDailyBriefing } from "./briefing.js";
import type { NotificationService } from "./notifications.js";
import type { AgentMessagingService } from "./agent-messaging.js";
import type { AutonomyTierService } from "./autonomy-tier.js";
import type { MonitoringService } from "./monitoring.js";
import { recordBackupSuccess } from "../plugins/observability.js";

const logger = createLogger("scheduler");

export interface SchedulerConfig {
  db: Db;
  llmRegistry: LlmRegistry;
  embeddingService?: EmbeddingService;
  n8nService: N8nService;
  sandboxService: SandboxService;
  workspaceService: WorkspaceService;
  notificationService?: NotificationService;
  messagingService?: AgentMessagingService;
  autonomyTierService?: AutonomyTierService;
  monitoringService?: MonitoringService;
  pollIntervalMs?: number;
  briefingHour?: number;
  briefingTimezone?: string;
}

export function startScheduler(config: SchedulerConfig): { stop: () => void } {
  const {
    db,
    llmRegistry,
    embeddingService,
    n8nService,
    sandboxService,
    workspaceService,
    notificationService,
    messagingService,
    autonomyTierService,
    monitoringService,
    pollIntervalMs = 60_000,
    briefingHour = 8,
    briefingTimezone = "America/New_York",
  } = config;

  let running = false;
  let lastBriefingDate = ""; // "YYYY-MM-DD" to send once per day
  let lastDecayDate = ""; // "YYYY-MM-DD" to decay once per day
  let lastCheckInHour = -1; // track last hour we ran proactive check-in
  let lastQuietCheckDate = ""; // "YYYY-MM-DD" to send quiet check-in at most once per day
  let lastBackupCheckDate = ""; // "YYYY-MM-DD" to check backup freshness once per day

  /** Run built-in daily system tasks (briefing + memory decay) */
  async function runSystemTasks() {
    const now = new Date();
    // Use configured timezone to determine the local date/hour
    const localTime = new Intl.DateTimeFormat("en-CA", {
      timeZone: briefingTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);

    const dateStr = localTime
      .filter((p) => ["year", "month", "day"].includes(p.type))
      .map((p) => p.value)
      .join("");
    const hour = Number(localTime.find((p) => p.type === "hour")?.value ?? 0);

    // Daily briefing: send once when hour matches
    if (hour >= briefingHour && lastBriefingDate !== dateStr && notificationService) {
      lastBriefingDate = dateStr;
      try {
        await sendDailyBriefing(db, notificationService, llmRegistry);
        logger.info({ dateStr }, "daily briefing sent by scheduler");
      } catch (err) {
        logger.error({ err }, "failed to send daily briefing");
      }
    }

    // Memory decay: run once per day at any hour
    if (lastDecayDate !== dateStr) {
      lastDecayDate = dateStr;
      try {
        await decayAllMemoryImportance(db);
        logger.info({ dateStr }, "memory importance decay applied");
      } catch (err) {
        logger.error({ err }, "failed to decay memory importance");
      }
    }

    // Proactive check-in: run at most once per hour
    if (hour !== lastCheckInHour && notificationService) {
      lastCheckInHour = hour;
      try {
        await runProactiveCheckIn();
      } catch (err) {
        logger.error({ err }, "proactive check-in failed");
      }
    }

    // Backup health check: once per day, update Prometheus gauge if fresh
    if (lastBackupCheckDate !== dateStr && monitoringService) {
      lastBackupCheckDate = dateStr;
      try {
        const backupHealth = await monitoringService.checkBackupHealth();
        if (backupHealth?.isFresh) {
          recordBackupSuccess();
          logger.info({ ageHours: backupHealth.lastBackupAge }, "backup health verified");
        } else if (backupHealth) {
          logger.warn({ ageHours: backupHealth.lastBackupAge }, "backup is stale");
        }
      } catch (err) {
        logger.error({ err }, "backup health check failed");
      }
    }
  }

  /** Check for stale goals and pending approvals, send reminders */
  async function runProactiveCheckIn() {
    if (!notificationService) return;

    // Pending approval reminders
    const pendingApprovals = await listPendingApprovals(db);
    if (pendingApprovals.length > 0) {
      await notificationService.notifyApprovalReminder(pendingApprovals.length);
      logger.info({ count: pendingApprovals.length }, "approval reminder sent");
    }

    // Stale goal nudges (48h+ no updates)
    const activeGoals = await listActiveGoals(db);
    const now = Date.now();
    const staleGoals = activeGoals
      .filter((g) => now - g.updatedAt.getTime() > 48 * 60 * 60 * 1000)
      .map((g) => ({
        title: g.title,
        hoursStale: Math.round((now - g.updatedAt.getTime()) / (60 * 60 * 1000)),
      }));

    if (staleGoals.length > 0) {
      await notificationService.notifyStaleGoals(staleGoals);
      logger.info({ count: staleGoals.length }, "stale goal nudge sent");
    }

    // "Been quiet" check-in: once per day, during working hours, after 6h silence
    const localParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: briefingTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());

    const localDateStr = localParts
      .filter((p) => ["year", "month", "day"].includes(p.type))
      .map((p) => p.value)
      .join("");
    const localHour = Number(localParts.find((p) => p.type === "hour")?.value ?? 0);

    if (lastQuietCheckDate !== localDateStr && localHour >= 9 && localHour <= 18) {
      const latestUserMessage = await getLatestUserMessageTime(db);
      if (latestUserMessage) {
        const silenceHours = (now - latestUserMessage.getTime()) / (60 * 60 * 1000);
        if (silenceHours >= 6) {
          lastQuietCheckDate = localDateStr;
          // Build suggestion from top stale goal or pending task
          let suggestion = "No specific suggestions — everything looks on track.";
          if (staleGoals.length > 0) {
            suggestion = `**${staleGoals[0].title}** has been idle for ${staleGoals[0].hoursStale}h. Consider running \`/execute\` or updating its status.`;
          } else if (activeGoals.length > 0) {
            suggestion = `Your top active goal is **${activeGoals[0].title}** (${activeGoals[0].taskCount > 0 ? `${activeGoals[0].completedTaskCount}/${activeGoals[0].taskCount} tasks` : "no tasks yet"}).`;
          }
          await notificationService.notifyQuietCheckIn(suggestion);
          logger.info({ silenceHours: Math.round(silenceHours) }, "quiet check-in sent");
        }
      }
    }
  }

  async function tick() {
    if (running) return; // skip if previous tick still running
    running = true;

    try {
      // Run built-in daily tasks (briefing, memory decay)
      await runSystemTasks();

      // Check daily token limit before executing schedules
      const dailyTokenLimit = parseInt(optionalEnv("DAILY_TOKEN_LIMIT", "0"), 10);
      if (dailyTokenLimit > 0) {
        const todayTotal = await getTodayTokenTotal(db);
        if (todayTotal >= dailyTokenLimit) {
          logger.warn({ todayTotal, dailyTokenLimit }, "daily token limit reached, skipping schedule execution");
          running = false;
          return;
        }
      }

      const dueSchedules = await listDueSchedules(db);
      if (dueSchedules.length === 0) {
        running = false;
        return;
      }

      logger.info({ count: dueSchedules.length }, "found due schedules");

      for (const schedule of dueSchedules) {
        const startTime = Date.now();
        let session;

        try {
          // Create work session for tracking
          session = await createWorkSession(db, {
            trigger: "schedule",
            scheduleId: schedule.id,
            context: { actionPrompt: schedule.actionPrompt, cronExpression: schedule.cronExpression },
          });

          // Skip if no LLM providers are available (e.g., all API credits exhausted)
          const availableProviders = llmRegistry.listProviders().filter((p) => p.available);
          if (availableProviders.length === 0) {
            logger.warn({ scheduleId: schedule.id }, "no LLM providers available, skipping schedule execution");
            // Still update next run so we don't hammer on the next tick
            const interval = CronExpressionParser.parse(schedule.cronExpression);
            const nextRunAt = interval.next().toDate();
            await updateScheduleLastRun(db, schedule.id, new Date(), nextRunAt);
            if (session) {
              await completeWorkSession(db, session.id, {
                tokensUsed: 0,
                durationMs: Date.now() - startTime,
                status: "failed",
                summary: "No LLM providers available — skipped",
              });
            }
            continue;
          }

          // Create an orchestrator instance for this execution
          const orchestrator = new Orchestrator({
            registry: llmRegistry,
            db,
            embeddingService,
            n8nService,
            sandboxService,
            workspaceService,
            messagingService,
            autonomyTierService,
            isAutonomous: true,
          });

          // Create a system user + conversation for scheduled tasks
          const user = await findOrCreateUser(db, "system-scheduler", "system");
          const conv = await createConversation(db, { userId: user.id, title: `Schedule: ${schedule.description ?? schedule.actionPrompt.slice(0, 50)}`, workspaceId: (schedule as { workspaceId?: string }).workspaceId ?? "" });

          // Run the orchestrator
          const result = await orchestrator.run(
            schedule.actionPrompt,
            conv.id,
            [],
            user.id,
          );

          // Calculate next run
          const interval = CronExpressionParser.parse(schedule.cronExpression);
          const nextRunAt = interval.next().toDate();
          await updateScheduleLastRun(db, schedule.id, new Date(), nextRunAt);

          // Complete work session
          const durationMs = Date.now() - startTime;
          await completeWorkSession(db, session.id, {
            tokensUsed: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
            durationMs,
            actionsTaken: [{ tool: "orchestrator", prompt: schedule.actionPrompt }],
            status: "completed",
            summary: typeof result.response === "string" ? result.response.slice(0, 500) : "Completed",
          });

          void createJournalEntry(db, {
            entryType: "work_session",
            title: `Schedule: ${schedule.description ?? schedule.actionPrompt.slice(0, 80)}`,
            summary: typeof result.response === "string" ? result.response.slice(0, 300) : "Completed",
            workSessionId: session.id,
            details: { scheduleId: schedule.id, durationMs, tokensUsed: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0) },
          }).catch((err) => logger.warn({ err }, "journal entry write failed"));

          logger.info(
            { scheduleId: schedule.id, durationMs, nextRunAt },
            "schedule executed successfully",
          );
        } catch (err) {
          const durationMs = Date.now() - startTime;
          logger.error({ err, scheduleId: schedule.id }, "schedule execution failed");

          // Still update next run so we don't retry immediately
          try {
            const interval = CronExpressionParser.parse(schedule.cronExpression);
            const nextRunAt = interval.next().toDate();
            await updateScheduleLastRun(db, schedule.id, new Date(), nextRunAt);
          } catch {
            // cron parse shouldn't fail for existing schedules, but just in case
          }

          if (session) {
            await completeWorkSession(db, session.id, {
              tokensUsed: 0,
              durationMs,
              status: "failed",
              summary: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    } finally {
      running = false;
    }
  }

  // Delay first tick to let providers stabilize after startup
  const startupDelay = setTimeout(tick, 30_000);
  startupDelay.unref();
  const intervalId = setInterval(tick, pollIntervalMs);
  intervalId.unref();

  logger.info({ pollIntervalMs }, "scheduler started");

  return {
    stop: () => {
      clearTimeout(startupDelay);
      clearInterval(intervalId);
      logger.info("scheduler stopped");
    },
  };
}
