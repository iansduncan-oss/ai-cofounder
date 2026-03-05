import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listRecentlyCompletedGoals,
  countTasksByStatus,
  listPendingApprovals,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";

const logger = createLogger("scheduler");

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STALE_THRESHOLD_HOURS = 24;

interface SchedulerConfig {
  db: Db;
  registry: LlmRegistry;
  webhookUrl: string;
  /** Hour of day (0-23) to send the morning briefing, default 9 */
  briefingHour: number;
  /** Timezone offset string like "America/New_York", used for display only */
  timezone: string;
}

/* ── Discord webhook helpers ── */

async function sendWebhook(
  webhookUrl: string,
  payload: { content?: string; embeds?: object[] },
): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "webhook returned non-OK status");
    }
  } catch (err) {
    logger.warn({ err }, "failed to send Discord webhook");
  }
}

/* ── Briefing data gathering ── */

interface BriefingData {
  activeGoals: Awaited<ReturnType<typeof listActiveGoals>>;
  recentlyCompleted: Awaited<ReturnType<typeof listRecentlyCompletedGoals>>;
  taskCounts: Record<string, number>;
  pendingApprovals: Awaited<ReturnType<typeof listPendingApprovals>>;
  staleGoalCount: number;
}

async function gatherBriefingData(db: Db): Promise<BriefingData> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [activeGoals, recentlyCompleted, taskCounts, pendingApprovals] = await Promise.all([
    listActiveGoals(db),
    listRecentlyCompletedGoals(db, since),
    countTasksByStatus(db),
    listPendingApprovals(db),
  ]);

  const staleGoalCount = activeGoals.filter(
    (g) => Date.now() - g.updatedAt.getTime() > STALE_THRESHOLD_HOURS * 60 * 60 * 1000,
  ).length;

  return { activeGoals, recentlyCompleted, taskCounts, pendingApprovals, staleGoalCount };
}

/* ── LLM-powered briefing generation ── */

function buildBriefingPrompt(data: BriefingData): string {
  const lines: string[] = [];
  lines.push("Generate a concise morning briefing for a solo founder. Be direct, no fluff.");
  lines.push("Use Discord markdown (bold, bullet points). Keep it under 1500 characters.");
  lines.push("");
  lines.push("Here's what's going on:");
  lines.push("");

  if (data.recentlyCompleted.length > 0) {
    lines.push("Goals completed in last 24h:");
    for (const g of data.recentlyCompleted) {
      lines.push(`  - "${g.title}"`);
    }
  } else {
    lines.push("No goals completed in the last 24 hours.");
  }

  lines.push("");
  lines.push(`Active goals: ${data.activeGoals.length}`);
  for (const g of data.activeGoals.slice(0, 5)) {
    const progress = g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount} tasks done` : "no tasks yet";
    const staleTag =
      Date.now() - g.updatedAt.getTime() > STALE_THRESHOLD_HOURS * 60 * 60 * 1000
        ? " [STALE]"
        : "";
    lines.push(`  - "${g.title}" (${g.priority}, ${progress})${staleTag}`);
  }

  if (data.activeGoals.length > 5) {
    lines.push(`  ... and ${data.activeGoals.length - 5} more`);
  }

  const totalTasks = Object.values(data.taskCounts).reduce((a, b) => a + b, 0);
  lines.push("");
  lines.push(
    `Task breakdown: ${totalTasks} total across active goals — ` +
      Object.entries(data.taskCounts)
        .map(([status, count]) => `${count} ${status}`)
        .join(", "),
  );

  if (data.pendingApprovals.length > 0) {
    lines.push("");
    lines.push(`Pending approvals: ${data.pendingApprovals.length} (needs your attention!)`);
  }

  if (data.staleGoalCount > 0) {
    lines.push("");
    lines.push(`${data.staleGoalCount} goal(s) haven't been touched in 24h+.`);
  }

  lines.push("");
  lines.push(
    "Based on this data, write the briefing. Include: " +
      "(1) a one-line overall status, " +
      "(2) what was accomplished, " +
      "(3) what needs attention today (prioritize stale goals + pending approvals), " +
      "(4) a suggested focus for the day. " +
      "Don't list raw IDs. Keep the tone like a sharp co-founder, not a corporate dashboard.",
  );

  return lines.join("\n");
}

async function generateBriefing(registry: LlmRegistry, data: BriefingData): Promise<string> {
  try {
    const response = await registry.complete("simple", {
      system:
        "You are an AI co-founder sending a morning briefing via Discord. " +
        "Be direct, concise, and useful. Use Discord markdown formatting.",
      messages: [{ role: "user", content: buildBriefingPrompt(data) }],
      max_tokens: 1024,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return text || buildFallbackBriefing(data);
  } catch (err) {
    logger.warn({ err }, "LLM briefing generation failed, using fallback");
    return buildFallbackBriefing(data);
  }
}

function buildFallbackBriefing(data: BriefingData): string {
  const lines: string[] = [];
  lines.push("**Morning Briefing**\n");

  if (data.recentlyCompleted.length > 0) {
    lines.push(
      `Completed yesterday: ${data.recentlyCompleted.map((g) => `**${g.title}**`).join(", ")}`,
    );
  }

  lines.push(`Active goals: **${data.activeGoals.length}**`);

  if (data.staleGoalCount > 0) {
    lines.push(`Stale goals (24h+ no updates): **${data.staleGoalCount}**`);
  }

  if (data.pendingApprovals.length > 0) {
    lines.push(`Pending approvals: **${data.pendingApprovals.length}** — use \`/approve\` to review`);
  }

  const topGoals = data.activeGoals.slice(0, 3);
  if (topGoals.length > 0) {
    lines.push("\n**Focus today:**");
    for (const g of topGoals) {
      const progress =
        g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount} tasks` : "no tasks";
      lines.push(`- ${g.title} (${progress})`);
    }
  }

  return lines.join("\n");
}

/* ── Scheduling logic ── */

let lastBriefingDate = "";

function shouldSendBriefing(briefingHour: number): boolean {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  // Already sent today
  if (lastBriefingDate === todayKey) return false;

  return now.getHours() >= briefingHour;
}

async function runBriefing(config: SchedulerConfig): Promise<void> {
  const data = await gatherBriefingData(config.db);

  // Skip if nothing to report
  if (data.activeGoals.length === 0 && data.recentlyCompleted.length === 0) {
    logger.info("no goals to report, skipping briefing");
    lastBriefingDate = new Date().toISOString().slice(0, 10);
    return;
  }

  const briefingText = await generateBriefing(config.registry, data);

  await sendWebhook(config.webhookUrl, {
    embeds: [
      {
        title: "Good morning — here's where we stand",
        description: briefingText,
        color: 5814783, // blue-purple
        footer: { text: `Briefing generated at ${new Date().toISOString()}` },
      },
    ],
  });

  lastBriefingDate = new Date().toISOString().slice(0, 10);
  logger.info("morning briefing sent");
}

async function runGoalCheckIn(config: SchedulerConfig): Promise<void> {
  const data = await gatherBriefingData(config.db);

  // Notify about pending approvals
  if (data.pendingApprovals.length > 0) {
    await sendWebhook(config.webhookUrl, {
      embeds: [
        {
          title: "Approvals waiting on you",
          description:
            `**${data.pendingApprovals.length}** task(s) need your sign-off before execution can continue.\n\n` +
            `Use \`/approve <id>\` to review and approve.`,
          color: 16098851, // amber
        },
      ],
    });
  }

  // Notify about stale goals (only if they've been stale for 48h+ to avoid spam)
  const veryStaleGoals = data.activeGoals.filter(
    (g) => Date.now() - g.updatedAt.getTime() > 48 * 60 * 60 * 1000,
  );
  if (veryStaleGoals.length > 0) {
    const goalList = veryStaleGoals
      .slice(0, 5)
      .map((g) => {
        const hours = Math.round((Date.now() - g.updatedAt.getTime()) / (60 * 60 * 1000));
        return `- **${g.title}** — ${hours}h since last update`;
      })
      .join("\n");

    await sendWebhook(config.webhookUrl, {
      embeds: [
        {
          title: "Goals going cold",
          description: `These have been sitting idle:\n\n${goalList}\n\nWant to \`/execute\` them or close them out?`,
          color: 15105570, // orange
        },
      ],
    });
  }
}

/* ── Entry point ── */

export function startScheduler(db: Db, registry: LlmRegistry): void {
  const webhookUrl = optionalEnv("DISCORD_FOLLOWUP_WEBHOOK_URL", "");
  if (!webhookUrl) {
    logger.info("DISCORD_FOLLOWUP_WEBHOOK_URL not set, scheduler disabled");
    return;
  }

  const briefingHour = parseInt(optionalEnv("BRIEFING_HOUR", "9"), 10);
  const timezone = optionalEnv("BRIEFING_TIMEZONE", "UTC");

  const config: SchedulerConfig = { db, registry, webhookUrl, briefingHour, timezone };

  logger.info(
    { briefingHour, timezone, checkIntervalMs: CHECK_INTERVAL_MS },
    "proactive scheduler started",
  );

  const check = async () => {
    try {
      // Morning briefing (once per day)
      if (shouldSendBriefing(briefingHour)) {
        await runBriefing(config);
      }

      // Goal check-ins (every hour, but messages are throttled by severity)
      await runGoalCheckIn(config);
    } catch (err) {
      logger.error({ err }, "scheduler check failed");
    }
  };

  // First check after 1 minute (let server warm up)
  setTimeout(check, 60 * 1000);
  setInterval(check, CHECK_INTERVAL_MS);
}
