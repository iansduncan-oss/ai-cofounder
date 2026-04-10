import { createLogger } from "@ai-cofounder/shared";
import { getMonitoringQueue, getBriefingQueue, getReflectionQueue, getRagIngestionQueue, getAutonomousSessionQueue, getMeetingPrepQueue } from "./queues.js";
import type { MonitoringJob, BriefingJob, ReflectionJob, AutonomousSessionJob, MeetingPrepJob } from "./queues.js";

const logger = createLogger("queue-scheduler");

/**
 * Sets up recurring jobs for JARVIS-like proactive monitoring.
 * Call once at server startup after Redis is connected.
 */
export async function setupRecurringJobs(options?: {
  briefingHour?: number;
  briefingTimezone?: string;
  monitoringIntervalMinutes?: number;
  autonomousSessionIntervalMinutes?: number;
}): Promise<void> {
  const {
    briefingHour = 9,
    briefingTimezone = "America/New_York",
    monitoringIntervalMinutes = 5,
  } = options ?? {};

  const monitoringQueue = getMonitoringQueue();
  const briefingQueue = getBriefingQueue();

  // ── Monitoring checks (every N minutes) ──

  const monitoringChecks: MonitoringJob[] = [
    { check: "github_ci" },
    { check: "github_prs" },
    { check: "vps_health" },
    { check: "vps_containers" },
  ];

  for (const job of monitoringChecks) {
    await monitoringQueue.upsertJobScheduler(
      `recurring-${job.check}`,
      {
        every: monitoringIntervalMinutes * 60 * 1000,
      },
      {
        name: job.check,
        data: job,
      },
    );
    logger.info(
      { check: job.check, intervalMin: monitoringIntervalMinutes },
      "Scheduled recurring monitoring",
    );
  }

  // ── Morning briefing (daily) ──

  await briefingQueue.upsertJobScheduler(
    "morning-briefing",
    {
      pattern: `0 ${briefingHour} * * *`,
      tz: briefingTimezone,
    },
    {
      name: "morning-briefing",
      data: {
        type: "morning" as const,
        deliveryChannels: ["slack", "discord"],
      } satisfies BriefingJob,
    },
  );
  logger.info(
    { hour: briefingHour, tz: briefingTimezone },
    "Scheduled morning briefing",
  );

  // ── Evening summary (daily at 6 PM) ──

  await briefingQueue.upsertJobScheduler(
    "evening-briefing",
    {
      pattern: `0 18 * * *`,
      tz: briefingTimezone,
    },
    {
      name: "evening-briefing",
      data: {
        type: "evening" as const,
        deliveryChannels: ["slack", "discord"],
      } satisfies BriefingJob,
    },
  );
  logger.info("Scheduled evening briefing at 18:00");

  // ── Weekly summary briefing (Monday at briefingHour) ──

  await briefingQueue.upsertJobScheduler(
    "weekly-summary",
    {
      pattern: `0 ${briefingHour} * * 1`,
      tz: briefingTimezone,
    },
    {
      name: "weekly-summary",
      data: {
        type: "weekly" as const,
        deliveryChannels: ["slack", "discord"],
      } satisfies BriefingJob,
    },
  );
  logger.info(
    { hour: briefingHour, tz: briefingTimezone },
    "Scheduled weekly summary (Mondays)",
  );

  // ── Weekly reflection pattern extraction (Sunday 3 AM) ──

  const reflectionQueue = getReflectionQueue();
  await reflectionQueue.upsertJobScheduler(
    "weekly-patterns",
    {
      pattern: `0 3 * * 0`,
      tz: briefingTimezone,
    },
    {
      name: "weekly-patterns",
      data: {
        action: "weekly_patterns",
      } satisfies ReflectionJob,
    },
  );
  logger.info("Scheduled weekly pattern extraction at Sunday 3 AM");

  // ── User pattern analysis (Sunday 4 AM, after weekly reflections) ──

  await reflectionQueue.upsertJobScheduler(
    "user-patterns",
    {
      pattern: `0 4 * * 0`,
      tz: briefingTimezone,
    },
    {
      name: "user-patterns",
      data: {
        action: "analyze_user_patterns",
      } satisfies ReflectionJob,
    },
  );
  logger.info("Scheduled user pattern analysis at Sunday 4 AM");

  // ── Daily pattern feedback processing (2 AM — adjusts confidence based on acceptance rates) ──

  await reflectionQueue.upsertJobScheduler(
    "daily-pattern-feedback",
    {
      pattern: `0 2 * * *`,
      tz: briefingTimezone,
    },
    {
      name: "daily-pattern-feedback",
      data: {
        action: "process_pattern_feedback",
      } satisfies ReflectionJob,
    },
  );
  logger.info("Scheduled daily pattern feedback processing at 2 AM");

  // ── Weekly memory consolidation (Sunday 4 AM) ──

  await reflectionQueue.upsertJobScheduler(
    "weekly-memory-consolidation",
    {
      pattern: "0 4 * * 0", // Sunday 4 AM
      tz: briefingTimezone,
    },
    {
      name: "weekly-memory-consolidation",
      data: {
        action: "consolidate_memories" as const,
      } satisfies ReflectionJob,
    },
  );
  logger.info("Scheduled weekly memory consolidation at Sunday 4 AM");

  // ── RAG conversation sweep (every 6 hours) ──

  const ragIngestionQueue = getRagIngestionQueue();
  await ragIngestionQueue.upsertJobScheduler(
    "recurring-conversation-sweep",
    {
      every: 6 * 60 * 60 * 1000, // 6 hours
    },
    {
      name: "conversation-sweep",
      data: { action: "ingest_conversations" as const, sourceId: "sweep" },
    },
  );
  logger.info("Scheduled RAG conversation sweep every 6 hours");

  // ── Approval timeout sweep (every 60 seconds) ──

  await monitoringQueue.upsertJobScheduler(
    "approval-timeout-sweep",
    {
      every: 60_000,
    },
    {
      name: "approval-timeout-sweep",
      data: { check: "approval_timeout_sweep" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled approval timeout sweep every 60s");

  // ── Budget check (every 60 seconds) ──

  await monitoringQueue.upsertJobScheduler(
    "budget-check",
    { every: 60_000 },
    {
      name: "budget-check",
      data: { check: "budget_check" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled budget check every 60s");

  // ── Sandbox orphan container cleanup (every 5 minutes) ──

  await monitoringQueue.upsertJobScheduler(
    "sandbox-orphan-cleanup",
    { every: 5 * 60 * 1000 },
    {
      name: "sandbox-orphan-cleanup",
      data: { check: "sandbox_orphan_cleanup" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled sandbox orphan cleanup every 5 minutes");

  // ── Dead-letter queue check (every 5 minutes) ──

  await monitoringQueue.upsertJobScheduler(
    "dlq-check",
    { every: 5 * 60 * 1000 },
    {
      name: "dlq-check",
      data: { check: "dlq_check" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled DLQ check every 5 minutes");

  // ── Follow-up reminders (daily at 9 AM) ──

  await monitoringQueue.upsertJobScheduler(
    "follow-up-reminders",
    {
      pattern: `0 ${briefingHour} * * *`,
      tz: briefingTimezone,
    },
    {
      name: "follow-up-reminders",
      data: { check: "follow_up_reminders" } satisfies MonitoringJob,
    },
  );
  logger.info({ hour: briefingHour, tz: briefingTimezone }, "Scheduled daily follow-up reminders");

  // ── Meeting prep: generate upcoming preps (hourly) ──

  const meetingPrepQueue = getMeetingPrepQueue();
  await meetingPrepQueue.upsertJobScheduler(
    "meeting-prep-generate",
    {
      pattern: "0 * * * *", // every hour
      tz: briefingTimezone,
    },
    {
      name: "meeting-prep-generate",
      data: { action: "generate_upcoming" } satisfies MeetingPrepJob,
    },
  );
  logger.info("Scheduled meeting prep generation (hourly)");

  // ── Meeting prep: send notifications (every 5 min) ──

  await meetingPrepQueue.upsertJobScheduler(
    "meeting-prep-notify",
    {
      every: 5 * 60 * 1000,
    },
    {
      name: "meeting-prep-notify",
      data: { action: "send_notifications" } satisfies MeetingPrepJob,
    },
  );
  logger.info("Scheduled meeting prep notifications (every 5 min)");

  // ── Self-healing check (every 15 minutes) ──

  await monitoringQueue.upsertJobScheduler(
    "self-healing-check",
    { every: 15 * 60 * 1000 },
    {
      name: "self-healing-check",
      data: { check: "self_healing_check" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled self-healing check every 15 minutes");

  // ── Recurring autonomous session (configurable interval, default 30 min) ──

  const autonomousIntervalMin = options?.autonomousSessionIntervalMinutes
    ?? Number(process.env.AUTONOMOUS_SESSION_INTERVAL_MINUTES ?? 30);
  const autonomousSessionQueue = getAutonomousSessionQueue();
  await autonomousSessionQueue.upsertJobScheduler(
    "recurring-autonomous-session",
    {
      every: autonomousIntervalMin * 60 * 1000,
    },
    {
      name: "autonomous-session",
      data: { trigger: "schedule" } satisfies AutonomousSessionJob,
    },
  );
  logger.info({ intervalMin: autonomousIntervalMin }, "Scheduled recurring autonomous session");

  // ── Discord hourly digest (top of every hour) ──

  await monitoringQueue.upsertJobScheduler(
    "discord-hourly-digest",
    {
      pattern: "0 * * * *",
      tz: briefingTimezone,
    },
    {
      name: "discord-hourly-digest",
      data: { check: "discord_hourly_digest" } satisfies MonitoringJob,
    },
  );
  logger.info("Scheduled Discord hourly digest");
}
