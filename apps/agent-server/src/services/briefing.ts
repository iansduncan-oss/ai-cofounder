import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listRecentWorkSessions,
  countTasksByStatus,
  getUsageSummary,
  listEnabledSchedules,
  listRecentlyCompletedGoals,
  listPendingApprovals,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("briefing");

export interface BriefingData {
  activeGoals: Array<{ title: string; priority: string; progress: string; hoursStale: number }>;
  completedYesterday: Array<{ title: string }>;
  taskBreakdown: Record<string, number>;
  costsSinceYesterday: { totalCostUsd: number; requestCount: number };
  upcomingSchedules: Array<{ description: string; nextRunAt: Date | null }>;
  recentSessions: Array<{ trigger: string; status: string; summary: string | null }>;
  pendingApprovalCount: number;
  staleGoalCount: number;
}

const STALE_THRESHOLD_HOURS = 48;

export async function gatherBriefingData(db: Db): Promise<BriefingData> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const [activeGoals, completedGoals, taskCounts, usage, schedules, sessions, pendingApprovals] =
    await Promise.all([
      listActiveGoals(db),
      listRecentlyCompletedGoals(db, yesterday),
      countTasksByStatus(db),
      getUsageSummary(db, { since: yesterday }),
      listEnabledSchedules(db),
      listRecentWorkSessions(db, 5),
      listPendingApprovals(db),
    ]);

  const now = Date.now();
  const goalsWithStaleness = activeGoals.map((g) => ({
    title: g.title,
    priority: g.priority,
    progress:
      g.taskCount > 0
        ? `${g.completedTaskCount}/${g.taskCount} tasks`
        : "no tasks yet",
    hoursStale: Math.round((now - g.updatedAt.getTime()) / (60 * 60 * 1000)),
  }));

  return {
    activeGoals: goalsWithStaleness,
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
    pendingApprovalCount: pendingApprovals.length,
    staleGoalCount: goalsWithStaleness.filter((g) => g.hoursStale >= STALE_THRESHOLD_HOURS).length,
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

  // Pending approvals
  if (data.pendingApprovalCount > 0) {
    lines.push(`**Pending Approvals:** ${data.pendingApprovalCount} \u2014 use \`/approve\` to review`);
    lines.push("");
  }

  // Stale goals
  if (data.staleGoalCount > 0) {
    lines.push(`**Stale Goals:** ${data.staleGoalCount} goal(s) idle for ${STALE_THRESHOLD_HOURS}h+`);
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

/** Build a prompt for the LLM to generate a narrative briefing */
function buildBriefingPrompt(data: BriefingData): string {
  const lines: string[] = [];
  lines.push("Generate a concise morning briefing for a solo founder. Be direct, no fluff.");
  lines.push("Use markdown (bold, bullet points). Keep it under 1500 characters.");
  lines.push("");

  if (data.completedYesterday.length > 0) {
    lines.push("Goals completed in last 24h:");
    for (const g of data.completedYesterday) {
      lines.push(`  - "${g.title}"`);
    }
  } else {
    lines.push("No goals completed in the last 24 hours.");
  }

  lines.push("");
  lines.push(`Active goals: ${data.activeGoals.length}`);
  for (const g of data.activeGoals.slice(0, 5)) {
    const staleTag = g.hoursStale >= STALE_THRESHOLD_HOURS ? " [STALE]" : "";
    lines.push(`  - "${g.title}" (${g.priority}, ${g.progress})${staleTag}`);
  }

  const totalTasks = Object.values(data.taskBreakdown).reduce((a, b) => a + b, 0);
  if (totalTasks > 0) {
    lines.push("");
    lines.push(
      `Task breakdown: ${totalTasks} total — ` +
        Object.entries(data.taskBreakdown)
          .map(([status, count]) => `${count} ${status}`)
          .join(", "),
    );
  }

  if (data.pendingApprovalCount > 0) {
    lines.push("");
    lines.push(`Pending approvals: ${data.pendingApprovalCount} (needs your attention!)`);
  }

  if (data.staleGoalCount > 0) {
    lines.push("");
    lines.push(`${data.staleGoalCount} goal(s) haven't been touched in ${STALE_THRESHOLD_HOURS}h+.`);
  }

  const costStr = data.costsSinceYesterday.totalCostUsd < 0.01
    ? "< $0.01"
    : `$${data.costsSinceYesterday.totalCostUsd.toFixed(2)}`;
  lines.push("");
  lines.push(`LLM costs (24h): ${costStr} across ${data.costsSinceYesterday.requestCount} requests`);

  lines.push("");
  lines.push(
    "Based on this data, write the briefing. Include: " +
      "(1) a one-line overall status, " +
      "(2) what was accomplished, " +
      "(3) what needs attention today (prioritize stale goals + pending approvals), " +
      "(4) a suggested focus for the day. " +
      "Keep the tone like a sharp co-founder, not a corporate dashboard.",
  );

  return lines.join("\n");
}

/** Generate a briefing using LLM, falling back to static format on error */
async function generateLlmBriefing(registry: LlmRegistry, data: BriefingData): Promise<string> {
  try {
    const response = await registry.complete("simple", {
      system:
        "You are an AI co-founder sending a morning briefing. " +
        "Be direct, concise, and useful. Use markdown formatting.",
      messages: [{ role: "user", content: buildBriefingPrompt(data) }],
      max_tokens: 1024,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return text || formatBriefing(data);
  } catch (err) {
    logger.warn({ err }, "LLM briefing generation failed, using static format");
    return formatBriefing(data);
  }
}

export async function sendDailyBriefing(
  db: Db,
  notificationService: NotificationService,
  llmRegistry?: LlmRegistry,
): Promise<string> {
  const data = await gatherBriefingData(db);

  const text = llmRegistry
    ? await generateLlmBriefing(llmRegistry, data)
    : formatBriefing(data);

  await notificationService.sendBriefing(text);
  logger.info("daily briefing sent");

  return text;
}
