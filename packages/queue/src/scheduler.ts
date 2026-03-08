import { createLogger } from "@ai-cofounder/shared";
import { getMonitoringQueue, getBriefingQueue, getReflectionQueue } from "./queues.js";
import type { MonitoringJob, BriefingJob, ReflectionJob } from "./queues.js";

const logger = createLogger("queue-scheduler");

/**
 * Sets up recurring jobs for JARVIS-like proactive monitoring.
 * Call once at server startup after Redis is connected.
 */
export async function setupRecurringJobs(options?: {
  briefingHour?: number;
  briefingTimezone?: string;
  monitoringIntervalMinutes?: number;
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
}
