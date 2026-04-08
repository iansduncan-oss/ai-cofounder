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
  upsertBriefingCache,
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
  todayEvents?: Array<{ summary: string; start: string; end: string; attendeeCount: number }>;
  unreadEmailCount?: number;
  importantEmails?: Array<{ from: string; subject: string; snippet: string }>;
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
      totalCostUsd: usage?.totalCostUsd ?? 0,
      requestCount: usage?.requestCount ?? 0,
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

export async function enrichWithGoogle(
  db: Db,
  adminUserId: string,
): Promise<Pick<BriefingData, "todayEvents" | "unreadEmailCount" | "importantEmails"> | null> {
  try {
    const { CalendarService } = await import("./calendar.js");
    const { GmailService } = await import("./gmail.js");

    const calendarService = new CalendarService(db, adminUserId);
    const gmailService = new GmailService(db, adminUserId);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const [events, unreadCount, recentEmails] = await Promise.all([
      calendarService.listEvents({
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        maxResults: 20,
      }),
      gmailService.getUnreadCount(),
      gmailService.listInbox(5),
    ]);

    return {
      todayEvents: events.map((e) => ({
        summary: e.summary,
        start: e.start,
        end: e.end,
        attendeeCount: e.attendeeCount,
      })),
      unreadEmailCount: unreadCount,
      importantEmails: recentEmails.map((e) => ({
        from: e.from,
        subject: e.subject,
        snippet: e.snippet,
      })),
    };
  } catch (err) {
    logger.warn({ err }, "Google enrichment failed — briefing will proceed without calendar/email data");
    return null;
  }
}

export function formatBriefing(data: BriefingData): string {
  const lines: string[] = [];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  lines.push(`**${greeting}, sir.** Here is your briefing for ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`);
  lines.push("");

  // Today's schedule
  if (data.todayEvents && data.todayEvents.length > 0) {
    lines.push(`**Today's Schedule (${data.todayEvents.length}):**`);
    for (const e of data.todayEvents) {
      const time = e.start.includes("T")
        ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "All day";
      const attendees = e.attendeeCount > 0 ? ` (${e.attendeeCount} attendees)` : "";
      lines.push(`  - ${time}: ${e.summary}${attendees}`);
    }
    lines.push("");
  }

  // Email highlights
  if (data.unreadEmailCount !== undefined) {
    lines.push(`**Email:** ${data.unreadEmailCount} unread`);
    if (data.importantEmails && data.importantEmails.length > 0) {
      for (const e of data.importantEmails) {
        lines.push(`  - ${e.from}: ${e.subject}`);
      }
    }
    lines.push("");
  }

  // Active goals
  if (data.activeGoals.length > 0) {
    lines.push(`**Active Goals (${data.activeGoals.length}):**`);
    for (const g of data.activeGoals) {
      const icon = g.priority === "critical" ? "!!!" : g.priority === "high" ? "!!" : "";
      lines.push(`  - ${g.title} (${g.progress}) ${icon}`);
    }
  } else {
    lines.push("**No active goals, sir.** Shall I suggest something to work on?");
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
    lines.push(`**Pending Approvals:** ${data.pendingApprovalCount} matter(s) awaiting your sign-off, sir`);
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
  lines.push("Generate a concise morning briefing. You are Jarvis, a composed British AI assistant. Address the user as 'sir'. Be direct, measured, and useful. No exclamation marks.");
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

  if (data.todayEvents && data.todayEvents.length > 0) {
    lines.push("");
    lines.push(`Today's calendar (${data.todayEvents.length} events):`);
    for (const e of data.todayEvents) {
      const time = e.start.includes("T")
        ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "All day";
      lines.push(`  - ${time}: "${e.summary}" (${e.attendeeCount} attendees)`);
    }
  }

  if (data.unreadEmailCount !== undefined) {
    lines.push("");
    lines.push(`Unread emails: ${data.unreadEmailCount}`);
    if (data.importantEmails && data.importantEmails.length > 0) {
      lines.push("Recent important emails:");
      for (const e of data.importantEmails) {
        lines.push(`  - From: ${e.from} — "${e.subject}"`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Based on this data, write the briefing. Include: " +
      "(1) a one-line overall status (e.g. 'All quiet overnight, sir' or 'A few matters to address, sir'), " +
      "(2) what was accomplished, " +
      "(3) what needs attention today (prioritise stale goals + pending approvals), " +
      (data.todayEvents && data.todayEvents.length > 0 ? "(4) today's meeting schedule, " : "") +
      `(${data.todayEvents && data.todayEvents.length > 0 ? "5" : "4"}) recommended priorities for today — frame as 'Might I suggest the following priorities, sir...' ` +
      "Keep the tone composed, formal but warm — like Jarvis from Iron Man. Use 'sir' sparingly but naturally. No exclamation marks.",
  );

  return lines.join("\n");
}

/** Generate a briefing using LLM, falling back to static format on error */
export async function generateLlmBriefing(registry: LlmRegistry, data: BriefingData): Promise<string> {
  try {
    const response = await registry.complete("simple", {
      system:
        "You are Jarvis, a personal AI assistant with dry British wit. " +
        "Deliver the briefing with composed efficiency. Address the user as 'sir'. " +
        "Be concise, measured, and useful. No exclamation marks. Use markdown formatting.",
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
  adminUserId?: string,
): Promise<string> {
  const data = await gatherBriefingData(db);

  // Enrich with Google Calendar + Gmail data when admin user is available
  if (adminUserId) {
    const enrichment = await enrichWithGoogle(db, adminUserId);
    if (enrichment) {
      Object.assign(data, enrichment);
    }
  }

  const text = llmRegistry
    ? await generateLlmBriefing(llmRegistry, data)
    : formatBriefing(data);

  await notificationService.sendBriefing(text);
  logger.info("daily briefing sent");

  // Cache the briefing for today
  const today = new Date().toISOString().slice(0, 10);
  await upsertBriefingCache(db, today, text).catch((err) => {
    logger.warn({ err }, "Failed to cache briefing");
  });

  return text;
}

/** Build prompt for evening wind-down summary */
function buildEveningPrompt(data: BriefingData): string {
  const lines: string[] = [];
  lines.push("Generate a concise evening wrap-up. You are Jarvis. Address the user as 'sir'. Be warm but measured. No exclamation marks.");
  lines.push("Use markdown (bold, bullet points). Keep it under 1000 characters.");
  lines.push("");

  if (data.completedYesterday.length > 0) {
    lines.push("Completed today:");
    for (const g of data.completedYesterday) {
      lines.push(`  - "${g.title}"`);
    }
  } else {
    lines.push("No goals completed today.");
  }

  lines.push("");
  lines.push(`Active goals remaining: ${data.activeGoals.length}`);
  for (const g of data.activeGoals.slice(0, 5)) {
    lines.push(`  - "${g.title}" (${g.priority}, ${g.progress})`);
  }

  if (data.pendingApprovalCount > 0) {
    lines.push("");
    lines.push(`Pending approvals carried over: ${data.pendingApprovalCount}`);
  }

  lines.push("");
  lines.push(
    "Based on this data, write an evening summary. Include: " +
      "(1) a brief acknowledgement of what was accomplished today, " +
      "(2) anything left open that carries over to tomorrow, " +
      "(3) a suggested top priority for tomorrow morning. " +
      "Frame it warmly — sir is winding down. Example opening: 'Good evening, sir. A productive day, all told.'",
  );

  return lines.join("\n");
}

/** Generate an evening wrap-up briefing using LLM */
export async function generateEveningWrapUp(registry: LlmRegistry, data: BriefingData): Promise<string> {
  try {
    const response = await registry.complete("simple", {
      system:
        "You are Jarvis, a personal AI assistant. " +
        "Deliver an evening summary with warmth and composure. Address the user as 'sir'. " +
        "Be brief — sir is winding down. No exclamation marks. Use markdown formatting.",
      messages: [{ role: "user", content: buildEveningPrompt(data) }],
      max_tokens: 768,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return text || "Good evening, sir. All matters are in order. Rest well.";
  } catch (err) {
    logger.warn({ err }, "LLM evening wrap-up generation failed");
    return "Good evening, sir. I was unable to generate a full summary, but all critical systems are operational.";
  }
}

/** Send evening wind-down briefing */
export async function sendEveningWrapUp(
  db: Db,
  notificationService: NotificationService,
  llmRegistry?: LlmRegistry,
): Promise<string> {
  const data = await gatherBriefingData(db);

  const text = llmRegistry
    ? await generateEveningWrapUp(llmRegistry, data)
    : "Good evening, sir. Today's session is complete. All systems remain operational.";

  await notificationService.sendBriefing(text);
  logger.info("evening wrap-up sent");

  return text;
}
