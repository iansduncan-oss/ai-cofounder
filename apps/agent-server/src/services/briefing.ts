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
  listFailurePatterns,
  upsertBriefingCache,
  getBriefingCache,
  getProductivityLog,
  getPrimaryAdminUserId,
  listDueFollowUps,
  markFollowUpReminderSent,
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
  discordActivity?: Array<{
    channelName: string;
    summary: string;
    category: string;
    urgency: string;
    suggestedAction: string;
  }>;
  productivity?: {
    todayPlan: Array<{ text: string; completed: boolean }>;
    streakDays: number;
    completionScore: number | null;
    mood: string | null;
    energyLevel: number | null;
  };
  overdueFollowUps?: Array<{ id: string; title: string; dueDate: Date | null }>;
  systemInsights?: string[];
  githubCi?: Array<{ repo: string; status: string; conclusion: string | null; url: string }>;
  githubPrs?: Array<{
    repo: string;
    number: number;
    title: string;
    author: string;
    isDraft: boolean;
  }>;
}

const STALE_THRESHOLD_HOURS = 48;

export async function gatherBriefingData(db: Db): Promise<BriefingData> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const [
    activeGoals,
    completedGoals,
    taskCounts,
    usage,
    schedules,
    sessions,
    pendingApprovals,
    adminUserId,
    dueFollowUps,
    failurePatternRows,
  ] = await Promise.all([
    listActiveGoals(db),
    listRecentlyCompletedGoals(db, yesterday),
    countTasksByStatus(db),
    getUsageSummary(db, { since: yesterday }),
    listEnabledSchedules(db),
    listRecentWorkSessions(db, 5),
    listPendingApprovals(db),
    getPrimaryAdminUserId(db),
    listDueFollowUps(db),
    listFailurePatterns(db, 5),
  ]);

  // Fetch today's productivity log if admin user exists
  let productivity: BriefingData["productivity"];
  if (adminUserId) {
    const today = new Date().toISOString().slice(0, 10);
    const log = await getProductivityLog(db, adminUserId, today);
    if (log) {
      productivity = {
        todayPlan: (log.plannedItems as { text: string; completed: boolean }[] | null) ?? [],
        streakDays: log.streakDays,
        completionScore: log.completionScore,
        mood: log.mood,
        energyLevel: log.energyLevel,
      };
    }
  }

  const now = Date.now();
  const goalsWithStaleness = activeGoals.map((g) => ({
    title: g.title,
    priority: g.priority,
    progress: g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount} tasks` : "no tasks yet",
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
    productivity,
    overdueFollowUps: dueFollowUps.map((f) => ({ id: f.id, title: f.title, dueDate: f.dueDate })),
    systemInsights: failurePatternRows
      .filter((p) => p.frequency >= 3)
      .map(
        (p) =>
          `**${p.toolName}** (${p.errorCategory}): ${p.frequency}x — "${(p.errorMessage ?? "").slice(0, 80)}"`,
      ),
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
    logger.warn(
      { err },
      "Google enrichment failed — briefing will proceed without calendar/email data",
    );
    return null;
  }
}

export function formatBriefing(data: BriefingData): string {
  const lines: string[] = [];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  lines.push(
    `**${greeting}, sir.** Here is your briefing for ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`,
  );
  lines.push("");

  // Productivity check-in (if logged today)
  if (data.productivity) {
    const p = data.productivity;
    const streakStr = p.streakDays > 1 ? ` — ${p.streakDays}-day streak` : "";
    const scoreStr = p.completionScore != null ? ` (${p.completionScore}% complete)` : "";
    lines.push(`**Productivity${streakStr}:**${scoreStr}`);
    if (p.todayPlan.length > 0) {
      for (const item of p.todayPlan) {
        const check = item.completed ? "[x]" : "[ ]";
        lines.push(`  ${check} ${item.text}`);
      }
    } else {
      lines.push(`  _No plan logged for today yet, sir._`);
    }
    if (p.mood || p.energyLevel != null) {
      const bits: string[] = [];
      if (p.mood) bits.push(`mood: ${p.mood}`);
      if (p.energyLevel != null) bits.push(`energy: ${p.energyLevel}/5`);
      lines.push(`  _${bits.join(", ")}_`);
    }
    lines.push("");
  }

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
    lines.push(
      `**Pending Approvals:** ${data.pendingApprovalCount} matter(s) awaiting your sign-off, sir`,
    );
    lines.push("");
  }

  // Overdue follow-ups (folded in to avoid separate reminder DMs)
  if (data.overdueFollowUps && data.overdueFollowUps.length > 0) {
    lines.push(`**Overdue Follow-ups (${data.overdueFollowUps.length}):**`);
    for (const f of data.overdueFollowUps.slice(0, 5)) {
      const when = f.dueDate ? ` (was due ${f.dueDate.toLocaleDateString()})` : "";
      lines.push(`  - ${f.title}${when}`);
    }
    if (data.overdueFollowUps.length > 5) {
      lines.push(`  _...and ${data.overdueFollowUps.length - 5} more_`);
    }
    lines.push("");
  }

  // Discord activity
  if (data.discordActivity && data.discordActivity.length > 0) {
    lines.push(`**Discord Activity (${data.discordActivity.length}):**`);
    for (const d of data.discordActivity.slice(0, 5)) {
      const urgencyTag = d.urgency === "high" ? " [!]" : "";
      lines.push(`  - #${d.channelName}: ${d.summary}${urgencyTag}`);
      if (d.suggestedAction) {
        lines.push(`    _Suggested: ${d.suggestedAction}_`);
      }
    }
    if (data.discordActivity.length > 5) {
      lines.push(`  _...and ${data.discordActivity.length - 5} more_`);
    }
    lines.push("");
  }

  // Stale goals
  if (data.staleGoalCount > 0) {
    lines.push(
      `**Stale Goals:** ${data.staleGoalCount} goal(s) idle for ${STALE_THRESHOLD_HOURS}h+`,
    );
    lines.push("");
  }

  // GitHub CI / PR status
  if (data.githubCi && data.githubCi.length > 0) {
    const failing = data.githubCi.filter((c) => c.status === "failure");
    const passing = data.githubCi.filter((c) => c.status === "success");
    if (failing.length > 0) {
      lines.push(`**CI Failures (${failing.length}):**`);
      for (const ci of failing) {
        lines.push(`  - ${ci.repo}: ${ci.conclusion ?? "failed"}`);
      }
      lines.push("");
    }
    if (passing.length > 0) {
      lines.push(`**CI Passing:** ${passing.map((c) => c.repo).join(", ")}`);
      lines.push("");
    }
  }

  if (data.githubPrs && data.githubPrs.length > 0) {
    lines.push(`**Open PRs (${data.githubPrs.length}):**`);
    for (const pr of data.githubPrs.slice(0, 5)) {
      const draft = pr.isDraft ? " [draft]" : "";
      lines.push(`  - ${pr.repo}#${pr.number}: ${pr.title} (${pr.author})${draft}`);
    }
    lines.push("");
  }

  // System insights (repeated failures)
  if (data.systemInsights && data.systemInsights.length > 0) {
    lines.push(`**System Patterns (${data.systemInsights.length}):**`);
    for (const insight of data.systemInsights) {
      lines.push(`  - ${insight}`);
    }
    lines.push("");
  }

  // Costs
  const costStr =
    data.costsSinceYesterday.totalCostUsd < 0.01
      ? "< $0.01"
      : `$${data.costsSinceYesterday.totalCostUsd.toFixed(2)}`;
  lines.push(
    `**LLM Costs (24h):** ${costStr} across ${data.costsSinceYesterday.requestCount} requests`,
  );
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
  lines.push(
    "Generate a concise morning briefing. You are Jarvis, a composed British AI assistant. Address the user as 'sir'. Be direct, measured, and useful. No exclamation marks.",
  );
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
    lines.push(
      `${data.staleGoalCount} goal(s) haven't been touched in ${STALE_THRESHOLD_HOURS}h+.`,
    );
  }

  const costStr =
    data.costsSinceYesterday.totalCostUsd < 0.01
      ? "< $0.01"
      : `$${data.costsSinceYesterday.totalCostUsd.toFixed(2)}`;
  lines.push("");
  lines.push(
    `LLM costs (24h): ${costStr} across ${data.costsSinceYesterday.requestCount} requests`,
  );

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

  if (data.discordActivity && data.discordActivity.length > 0) {
    lines.push("");
    lines.push(`Discord activity since last briefing (${data.discordActivity.length} items):`);
    for (const d of data.discordActivity.slice(0, 5)) {
      lines.push(`  - #${d.channelName} [${d.urgency}] ${d.category}: ${d.summary}`);
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
export async function generateLlmBriefing(
  registry: LlmRegistry,
  data: BriefingData,
): Promise<string> {
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
  monitoringService?: {
    checkGitHubCI(): Promise<
      Array<{ repo: string; status: string; conclusion: string | null; url: string }>
    >;
    checkGitHubPRs(): Promise<
      Array<{ repo: string; number: number; title: string; author: string; isDraft: boolean }>
    >;
  },
): Promise<string> {
  // Auto-generate today's plan BEFORE gathering briefing data so the plan
  // shows up in the message. Uses merge mode so a manual check-in is preserved.
  if (llmRegistry) {
    try {
      const { generateDailyPlan } = await import("./auto-planner.js");
      await generateDailyPlan(db, llmRegistry, { merge: true });
    } catch (err) {
      logger.warn({ err }, "auto-plan generation failed in briefing (non-fatal)");
    }
  }

  const data = await gatherBriefingData(db);

  // Mark overdue follow-ups as reminder-sent so the standalone reminder job
  // won't also DM them. Non-fatal if it fails.
  if (data.overdueFollowUps && data.overdueFollowUps.length > 0) {
    for (const fu of data.overdueFollowUps) {
      try {
        await markFollowUpReminderSent(db, fu.id);
      } catch (err) {
        logger.warn({ err, id: fu.id }, "mark reminder-sent failed (non-fatal)");
      }
    }
  }

  // Enrich with GitHub CI + PR data
  if (monitoringService) {
    try {
      const [ciStatus, openPRs] = await Promise.all([
        monitoringService.checkGitHubCI(),
        monitoringService.checkGitHubPRs(),
      ]);
      if (ciStatus.length > 0) data.githubCi = ciStatus;
      if (openPRs.length > 0) data.githubPrs = openPRs;
    } catch {
      // GitHub data unavailable — skip
    }
  }

  // Enrich with Google Calendar + Gmail data when admin user is available
  if (adminUserId) {
    const enrichment = await enrichWithGoogle(db, adminUserId);
    if (enrichment) {
      Object.assign(data, enrichment);
    }
  }

  // Flush Discord daily digest into briefing
  try {
    const { DiscordDigestService } = await import("./discord-digest.js");
    const digestService = new DiscordDigestService();
    const dailyItems = await digestService.flush("daily");
    if (dailyItems.length > 0) {
      data.discordActivity = dailyItems.map((d) => ({
        channelName: d.channelName,
        summary: d.summary,
        category: d.category,
        urgency: d.urgency,
        suggestedAction: d.suggestedAction,
      }));
    }
  } catch {
    // Discord digest unavailable — skip
  }

  const text = llmRegistry ? await generateLlmBriefing(llmRegistry, data) : formatBriefing(data);

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
  lines.push(
    "Generate a concise evening wrap-up. You are Jarvis. Address the user as 'sir'. Be warm but measured. No exclamation marks.",
  );
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

  if (data.discordActivity && data.discordActivity.length > 0) {
    lines.push("");
    lines.push(`Discord activity today (${data.discordActivity.length} items):`);
    for (const d of data.discordActivity.slice(0, 3)) {
      lines.push(`  - #${d.channelName}: ${d.summary}`);
    }
  }

  // Productivity wrap-up — how did today's plan go?
  if (data.productivity) {
    const p = data.productivity;
    const done = p.todayPlan.filter((i) => i.completed).length;
    const total = p.todayPlan.length;
    lines.push("");
    lines.push(
      `Today's plan: ${done}/${total} complete (${p.completionScore ?? 0}%), streak: ${p.streakDays} day(s)`,
    );
    const remaining = p.todayPlan.filter((i) => !i.completed);
    if (remaining.length > 0) {
      lines.push(
        `Items left: ${remaining
          .slice(0, 3)
          .map((i) => `"${i.text}"`)
          .join(", ")}${remaining.length > 3 ? `, +${remaining.length - 3} more` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "Based on this data, write an evening summary. Include: " +
      "(1) a brief acknowledgement of what was accomplished today (use the productivity completion score if provided), " +
      "(2) anything left open that carries over to tomorrow, " +
      "(3) a suggested top priority for tomorrow morning, " +
      "(4) a short reflection prompt at the end asking sir to log highlights/blockers via `/reflect`. " +
      "Frame it warmly — sir is winding down. Example opening: 'Good evening, sir. A productive day, all told.'",
  );

  return lines.join("\n");
}

/** Generate an evening wrap-up briefing using LLM */
export async function generateEveningWrapUp(
  registry: LlmRegistry,
  data: BriefingData,
): Promise<string> {
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

/**
 * Build a weekly summary from the last 7 days of cached daily briefings.
 * Falls back to a static message if no briefings are cached. When an
 * LlmRegistry is supplied, runs the aggregated text through an LLM for a
 * narrative rollup; otherwise returns the concatenated briefings directly.
 */
export async function generateWeeklySummary(db: Db, llmRegistry?: LlmRegistry): Promise<string> {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const cached = await Promise.all(dates.map((date) => getBriefingCache(db, date)));
  const entries = cached
    .map((row, i) => ({ date: dates[i], text: row?.briefingText ?? null }))
    .filter((e): e is { date: string; text: string } => Boolean(e.text));

  if (entries.length === 0) {
    return "Good morning, sir. No daily briefings were recorded in the past week — nothing to summarise.";
  }

  const combined = entries.map((e) => `### ${e.date}\n\n${e.text}`).join("\n\n---\n\n");

  if (!llmRegistry) {
    return `# Weekly Summary\n\nThe past ${entries.length} day(s) of briefings:\n\n${combined}`;
  }

  try {
    const response = await llmRegistry.complete("simple", {
      system:
        "You are Jarvis, a personal AI assistant with dry British wit. " +
        "Roll up the past week of daily briefings into a single, concise weekly summary. " +
        "Address the user as 'sir'. Use markdown. Highlight themes, trends, and open threads. " +
        "Keep it under 800 words and avoid repeating identical items.",
      messages: [
        {
          role: "user",
          content:
            `Summarise the week. Source briefings (most recent first):\n\n${combined}\n\n` +
            "Output sections: **The Week in Review**, **Open Threads**, **Recommended Focus for Next Week**.",
        },
      ],
      max_tokens: 1200,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return text || `# Weekly Summary\n\n${combined}`;
  } catch (err) {
    logger.warn({ err }, "LLM weekly summary generation failed, returning concatenated briefings");
    return `# Weekly Summary\n\n${combined}`;
  }
}

/** Send a weekly summary via the notification pipeline. */
export async function sendWeeklySummary(
  db: Db,
  notificationService: NotificationService,
  llmRegistry?: LlmRegistry,
): Promise<string> {
  const text = await generateWeeklySummary(db, llmRegistry);
  await notificationService.sendBriefing(text);
  logger.info("weekly summary sent");
  return text;
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
