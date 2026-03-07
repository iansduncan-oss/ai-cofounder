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
} from "@ai-cofounder/db";
import type { Db } from "@ai-cofounder/db";
import { Orchestrator } from "../agents/orchestrator.js";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import type { N8nService } from "./n8n.js";
import type { SandboxService } from "@ai-cofounder/sandbox";
import type { WorkspaceService } from "./workspace.js";
import { sendDailyBriefing } from "./briefing.js";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("scheduler");

export interface SchedulerConfig {
  db: Db;
  llmRegistry: LlmRegistry;
  embeddingService?: EmbeddingService;
  n8nService: N8nService;
  sandboxService: SandboxService;
  workspaceService: WorkspaceService;
  notificationService?: NotificationService;
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
    pollIntervalMs = 60_000,
    briefingHour = 8,
    briefingTimezone = "America/New_York",
  } = config;

  let running = false;
  let lastBriefingDate = ""; // "YYYY-MM-DD" to send once per day
  let lastDecayDate = ""; // "YYYY-MM-DD" to decay once per day

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
        await sendDailyBriefing(db, notificationService);
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
  }

  async function tick() {
    if (running) return; // skip if previous tick still running
    running = true;

    try {
      // Run built-in daily tasks (briefing, memory decay)
      await runSystemTasks();

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

          // Create an orchestrator instance for this execution
          const orchestrator = new Orchestrator(
            llmRegistry,
            db,
            "conversation",
            embeddingService,
            n8nService,
            sandboxService,
            workspaceService,
          );

          // Create a system user + conversation for scheduled tasks
          const user = await findOrCreateUser(db, "system-scheduler", "system");
          const conv = await createConversation(db, { userId: user.id, title: `Schedule: ${schedule.description ?? schedule.actionPrompt.slice(0, 50)}` });

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

  // Run immediately on start, then poll
  tick();
  const intervalId = setInterval(tick, pollIntervalMs);
  intervalId.unref();

  logger.info({ pollIntervalMs }, "scheduler started");

  return {
    stop: () => {
      clearInterval(intervalId);
      logger.info("scheduler stopped");
    },
  };
}
