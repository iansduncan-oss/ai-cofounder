import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  listActiveGoals,
  listPendingTasks,
  listFollowUps,
  getProductivityLog,
  upsertProductivityLog,
  getPrimaryAdminUserId,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";

const logger = createLogger("auto-planner");

export interface AutoPlanItem {
  text: string;
  completed: boolean;
}

export interface AutoPlanResult {
  date: string;
  plannedItems: AutoPlanItem[];
  reasoning?: string;
  skipped?: boolean;
  reason?: string;
}

interface GatheredContext {
  activeGoals: Array<{ title: string; priority: string; progress: string }>;
  pendingTasks: Array<{ title: string; goalTitle?: string }>;
  overdueFollowUps: Array<{ title: string; dueDate: Date | null }>;
  upcomingFollowUps: Array<{ title: string; dueDate: Date | null }>;
  todayEvents: Array<{ summary: string; start: string; end: string }>;
  yesterdayBlockers?: string;
  yesterdayCompletion?: number | null;
}

async function gatherContext(db: Db, adminUserId: string): Promise<GatheredContext> {
  const [activeGoals, pendingTasks, allFollowUps] = await Promise.all([
    listActiveGoals(db),
    listPendingTasks(db, 15),
    listFollowUps(db, { status: "pending", limit: 30 }),
  ]);

  const now = new Date();
  const goalsById = new Map(activeGoals.map((g) => [g.id, g.title]));

  const overdueFollowUps: GatheredContext["overdueFollowUps"] = [];
  const upcomingFollowUps: GatheredContext["upcomingFollowUps"] = [];
  for (const f of allFollowUps.data) {
    if (!f.dueDate) continue;
    if (f.dueDate < now) {
      overdueFollowUps.push({ title: f.title, dueDate: f.dueDate });
    } else {
      // Within next 48h counts as upcoming
      if (f.dueDate.getTime() - now.getTime() < 48 * 60 * 60 * 1000) {
        upcomingFollowUps.push({ title: f.title, dueDate: f.dueDate });
      }
    }
  }

  // Yesterday's blockers + completion (for calibration)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yLog = await getProductivityLog(db, adminUserId, yesterday.toISOString().slice(0, 10));

  // Today's calendar events (optional — only if Google is connected)
  let todayEvents: GatheredContext["todayEvents"] = [];
  try {
    const { CalendarService } = await import("./calendar.js");
    const calendarService = new CalendarService(db, adminUserId);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const events = await calendarService.listEvents({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults: 20,
    });
    todayEvents = events.map((e) => ({ summary: e.summary, start: e.start, end: e.end }));
  } catch (err) {
    logger.debug({ err }, "calendar unavailable for auto-plan (non-fatal)");
  }

  return {
    activeGoals: activeGoals.slice(0, 8).map((g) => ({
      title: g.title,
      priority: g.priority,
      progress: g.taskCount > 0 ? `${g.completedTaskCount}/${g.taskCount} tasks` : "no tasks yet",
    })),
    pendingTasks: pendingTasks.slice(0, 10).map((t) => ({
      title: t.title,
      goalTitle: t.goalId ? goalsById.get(t.goalId) : undefined,
    })),
    overdueFollowUps,
    upcomingFollowUps,
    todayEvents,
    yesterdayBlockers: yLog?.blockers ?? undefined,
    yesterdayCompletion: yLog?.completionScore ?? null,
  };
}

function buildPlanPrompt(ctx: GatheredContext): string {
  const lines: string[] = [];
  lines.push("Generate a focused daily plan of 3-5 specific tasks for today.");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Each task must be specific and finishable in under 2 hours");
  lines.push('- NO vague items like "work on X" — use verbs like Ship, Review, Draft, Fix');
  lines.push("- If the user has many meetings, pick fewer tasks (aim for 3 on heavy meeting days)");
  lines.push("- Prioritize overdue follow-ups and critical/high priority goal work");
  lines.push("- Respect yesterday's blockers — if a task was blocked, suggest a different angle or an unblocking action");
  lines.push("");
  lines.push("Output a JSON object exactly like this, nothing else:");
  lines.push('{"items": ["Task 1", "Task 2", "Task 3"], "reasoning": "One sentence explaining priorities"}');
  lines.push("");
  lines.push("--- CONTEXT ---");

  if (ctx.todayEvents.length > 0) {
    lines.push(`\nToday's calendar (${ctx.todayEvents.length} events):`);
    for (const e of ctx.todayEvents.slice(0, 8)) {
      const time = e.start.includes("T")
        ? new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "All day";
      lines.push(`  - ${time}: ${e.summary}`);
    }
  } else {
    lines.push("\nToday's calendar: no events");
  }

  if (ctx.overdueFollowUps.length > 0) {
    lines.push(`\nOVERDUE follow-ups (${ctx.overdueFollowUps.length}):`);
    for (const f of ctx.overdueFollowUps.slice(0, 5)) {
      lines.push(`  - "${f.title}"`);
    }
  }

  if (ctx.upcomingFollowUps.length > 0) {
    lines.push(`\nDue within 48h (${ctx.upcomingFollowUps.length}):`);
    for (const f of ctx.upcomingFollowUps.slice(0, 5)) {
      lines.push(`  - "${f.title}"`);
    }
  }

  if (ctx.activeGoals.length > 0) {
    lines.push(`\nActive goals (${ctx.activeGoals.length}):`);
    for (const g of ctx.activeGoals) {
      lines.push(`  - [${g.priority}] "${g.title}" (${g.progress})`);
    }
  }

  if (ctx.pendingTasks.length > 0) {
    lines.push(`\nPending tasks across goals:`);
    for (const t of ctx.pendingTasks) {
      const goalTag = t.goalTitle ? ` [from: ${t.goalTitle}]` : "";
      lines.push(`  - "${t.title}"${goalTag}`);
    }
  }

  if (ctx.yesterdayBlockers) {
    lines.push(`\nYesterday's blockers: ${ctx.yesterdayBlockers}`);
  }
  if (ctx.yesterdayCompletion != null) {
    lines.push(`Yesterday's completion: ${ctx.yesterdayCompletion}%`);
    if (ctx.yesterdayCompletion < 50) {
      lines.push("Note: completion was low yesterday — bias toward smaller, concrete tasks today.");
    }
  }

  return lines.join("\n");
}

function parsePlanResponse(text: string): { items: string[]; reasoning?: string } | null {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .filter((i: unknown): i is string => typeof i === "string")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 5);
    if (items.length === 0) return null;
    return {
      items,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch {
    return null;
  }
}

export interface AutoPlannerOptions {
  /** If true, overwrite any existing plan for today. Default false (skip if plan exists). */
  force?: boolean;
  /** If true, merge new items with existing plan. Default false. */
  merge?: boolean;
}

/**
 * Generate today's productivity plan using the LLM based on active goals, tasks, follow-ups, and calendar.
 * Upserts the result into the productivity_logs table.
 */
export async function generateDailyPlan(
  db: Db,
  llmRegistry: LlmRegistry,
  options: AutoPlannerOptions = {},
): Promise<AutoPlanResult> {
  const adminUserId = await getPrimaryAdminUserId(db);
  if (!adminUserId) {
    return { date: "", plannedItems: [], skipped: true, reason: "no admin user configured" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const existing = await getProductivityLog(db, adminUserId, today);
  const existingItems = (existing?.plannedItems as AutoPlanItem[] | null) ?? [];

  if (existing && existingItems.length > 0 && !options.force && !options.merge) {
    return {
      date: today,
      plannedItems: existingItems,
      skipped: true,
      reason: "plan already exists for today",
    };
  }

  const ctx = await gatherContext(db, adminUserId);

  // If there's nothing to plan from, return empty
  const totalSignals =
    ctx.activeGoals.length +
    ctx.pendingTasks.length +
    ctx.overdueFollowUps.length +
    ctx.upcomingFollowUps.length;
  if (totalSignals === 0) {
    logger.info("no signals available for auto-plan");
    return {
      date: today,
      plannedItems: [],
      skipped: true,
      reason: "no active goals, tasks, or follow-ups to plan from",
    };
  }

  const prompt = buildPlanPrompt(ctx);
  let items: string[] = [];
  let reasoning: string | undefined;

  try {
    const response = await llmRegistry.complete("simple", {
      system:
        "You are a productivity planner generating a daily task list. " +
        "You are decisive and concrete. You output only valid JSON.",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    });

    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const parsed = parsePlanResponse(text);
    if (parsed) {
      items = parsed.items;
      reasoning = parsed.reasoning;
    } else {
      logger.warn({ text: text.slice(0, 200) }, "failed to parse LLM plan response");
    }
  } catch (err) {
    logger.error({ err }, "auto-planner LLM call failed");
  }

  // Fallback: build a simple plan from the highest-priority signals
  if (items.length === 0) {
    const fallback: string[] = [];
    for (const f of ctx.overdueFollowUps.slice(0, 2)) fallback.push(`Handle: ${f.title}`);
    for (const t of ctx.pendingTasks.slice(0, 3)) fallback.push(t.title);
    if (fallback.length === 0 && ctx.activeGoals.length > 0) {
      fallback.push(`Make progress on: ${ctx.activeGoals[0].title}`);
    }
    items = fallback.slice(0, 5);
    reasoning = "Generated from highest-priority pending items (LLM fallback)";
  }

  if (items.length === 0) {
    return { date: today, plannedItems: [], skipped: true, reason: "no tasks could be generated" };
  }

  const newItems: AutoPlanItem[] = items.map((text) => ({ text, completed: false }));

  // Merge mode: keep existing items, append new (dedupe by text)
  let finalItems = newItems;
  if (options.merge && existingItems.length > 0) {
    const existingTexts = new Set(existingItems.map((i) => i.text.toLowerCase()));
    const additions = newItems.filter((i) => !existingTexts.has(i.text.toLowerCase()));
    finalItems = [...existingItems, ...additions];
  }

  // Compute streak
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const prevLog = await getProductivityLog(db, adminUserId, yesterday.toISOString().slice(0, 10));
  const streakDays = existing?.streakDays ?? (prevLog ? prevLog.streakDays + 1 : 1);

  await upsertProductivityLog(db, {
    userId: adminUserId,
    date: today,
    plannedItems: finalItems,
    streakDays,
    metadata: { autoGenerated: true, reasoning, generatedAt: new Date().toISOString() },
  });

  logger.info({ date: today, count: finalItems.length, merge: options.merge }, "daily plan auto-generated");

  return {
    date: today,
    plannedItems: finalItems,
    reasoning,
  };
}
