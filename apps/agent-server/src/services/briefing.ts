import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listRecentWorkSessions,
  countTasksByStatus,
  getUsageSummary,
  listEnabledSchedules,
  listRecentlyCompletedGoals,
} from "@ai-cofounder/db";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("briefing");

export interface BriefingData {
  activeGoals: Array<{ title: string; priority: string; progress: string }>;
  completedYesterday: Array<{ title: string }>;
  taskBreakdown: Record<string, number>;
  costsSinceYesterday: { totalCostUsd: number; requestCount: number };
  upcomingSchedules: Array<{ description: string; nextRunAt: Date | null }>;
  recentSessions: Array<{ trigger: string; status: string; summary: string | null }>;
}

export async function generateBriefing(db: Db): Promise<BriefingData> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const [activeGoals, completedGoals, taskCounts, usage, schedules, sessions] =
    await Promise.all([
      listActiveGoals(db),
      listRecentlyCompletedGoals(db, yesterday),
      countTasksByStatus(db),
      getUsageSummary(db, { since: yesterday }),
      listEnabledSchedules(db),
      listRecentWorkSessions(db, 5),
    ]);

  return {
    activeGoals: activeGoals.map((g) => ({
      title: g.title,
      priority: g.priority,
      progress:
        g.taskCount > 0
          ? `${g.completedTaskCount}/${g.taskCount} tasks`
          : "no tasks yet",
    })),
    completedYesterday: completedGoals.map((g) => ({ title: g.title })),
    taskBreakdown: taskCounts,
    costsSinceYesterday: {
      totalCostUsd: usage.totalCostUsd,
      requestCount: usage.requestCount,
    },
    upcomingSchedules: schedules.slice(0, 5).map((s) => ({
      description: s.description ?? s.actionPrompt.slice(0, 80),
      nextRunAt: s.nextRunAt,
    })),
    recentSessions: sessions.map((s) => ({
      trigger: s.trigger,
      status: s.status,
      summary: s.summary,
    })),
  };
}

export function formatBriefing(data: BriefingData): string {
  const lines: string[] = [];
  const now = new Date();
  lines.push(`**Daily Briefing** — ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`);
  lines.push("");

  // Active goals
  if (data.activeGoals.length > 0) {
    lines.push(`**Active Goals (${data.activeGoals.length}):**`);
    for (const g of data.activeGoals) {
      const icon = g.priority === "critical" ? "!!!" : g.priority === "high" ? "!!" : "";
      lines.push(`  - ${g.title} (${g.progress}) ${icon}`);
    }
  } else {
    lines.push("**No active goals.** Time to plan something?");
  }
  lines.push("");

  // Yesterday's completions
  if (data.completedYesterday.length > 0) {
    lines.push(`**Completed Yesterday (${data.completedYesterday.length}):**`);
    for (const g of data.completedYesterday) {
      lines.push(`  - ${g.title}`);
    }
    lines.push("");
  }

  // Task breakdown
  const totalTasks = Object.values(data.taskBreakdown).reduce((a, b) => a + b, 0);
  if (totalTasks > 0) {
    const parts = Object.entries(data.taskBreakdown)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${count} ${status}`);
    lines.push(`**Tasks:** ${totalTasks} total — ${parts.join(", ")}`);
    lines.push("");
  }

  // Costs
  const costStr = data.costsSinceYesterday.totalCostUsd < 0.01
    ? "< $0.01"
    : `$${data.costsSinceYesterday.totalCostUsd.toFixed(2)}`;
  lines.push(`**LLM Costs (24h):** ${costStr} across ${data.costsSinceYesterday.requestCount} requests`);
  lines.push("");

  // Upcoming schedules
  if (data.upcomingSchedules.length > 0) {
    lines.push("**Upcoming Schedules:**");
    for (const s of data.upcomingSchedules) {
      const when = s.nextRunAt ? s.nextRunAt.toLocaleString() : "unknown";
      lines.push(`  - ${s.description} (next: ${when})`);
    }
    lines.push("");
  }

  // Recent sessions
  if (data.recentSessions.length > 0) {
    lines.push("**Recent Work Sessions:**");
    for (const s of data.recentSessions) {
      const summary = s.summary ? s.summary.slice(0, 100) : "no summary";
      lines.push(`  - [${s.status}] ${s.trigger}: ${summary}`);
    }
  }

  return lines.join("\n");
}

export async function sendDailyBriefing(
  db: Db,
  notificationService: NotificationService,
): Promise<string> {
  const data = await generateBriefing(db);
  const text = formatBriefing(data);

  await notificationService.sendBriefing(text);
  logger.info("daily briefing sent");

  return text;
}
