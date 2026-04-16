import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getProductivityLog,
  upsertProductivityLog,
  getPrimaryAdminUserId,
  listRecentlyCompletedTasks,
  listRecentlyCompletedFollowUps,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { NotificationService } from "./notifications.js";
import { generateDailyPlan } from "./auto-planner.js";

const logger = createLogger("proactive-engine");

/** Types of proactive pushes, used for dedup + cooldown tracking. */
export type ProactivePushType =
  | "wake_up" // 11 AM+ and no completions yet
  | "stall" // 2h+ idle during work hours with pending items
  | "critical_insight" // new critical codebase issue
  | "celebration" // just hit 100% completion
  | "end_of_day"; // 5:30 PM wrap-up

interface PushedRecord {
  type: ProactivePushType;
  at: string; // ISO timestamp
  context?: string;
}

/** Global daily cap across all proactive pushes. Scales with chatty mode. */
const DAILY_PUSH_CAP = process.env.PROACTIVE_CHATTY === "0" ? 3 : 5;

/**
 * Active hours: only fire proactive pushes during this window.
 * Default: 6 AM – 10 PM (quiet hours 10 PM – 6 AM).
 */
const WORK_HOUR_START = 6;
const WORK_HOUR_END = 22;

/**
 * Which triggers to actually evaluate. Critical insights are always on — they're
 * the only true "page me immediately" category.
 *
 * CHATTY is ON by default. Set PROACTIVE_CHATTY=0 to disable the wake_up / stall /
 * celebration triggers and get only briefings + critical insights.
 *
 * Note: end_of_day is NOT in the chatty list because the evening briefing at 20:00
 * already includes the productivity wrap-up and reflection prompt.
 */
const CHATTY = process.env.PROACTIVE_CHATTY !== "0";

/** Per-trigger cooldowns (milliseconds). */
const COOLDOWNS: Record<ProactivePushType, number> = {
  wake_up: 24 * 60 * 60 * 1000, // once per day
  stall: 2 * 60 * 60 * 1000, // once per 2h
  critical_insight: 60 * 60 * 1000, // once per hour
  celebration: 24 * 60 * 60 * 1000, // once per day
  end_of_day: 24 * 60 * 60 * 1000, // once per day
};

function isWorkHours(date = new Date()): boolean {
  const h = date.getHours();
  return h >= WORK_HOUR_START && h < WORK_HOUR_END;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isStartOfDay(date = new Date()): boolean {
  // Don't consider the very-start-of-day for cooldown math — gives the morning nudge clear air
  return date.getHours() < 10;
}

/**
 * ProactiveEngine evaluates a set of triggers against current user state and
 * proactively pushes Slack/Discord notifications without any user action.
 *
 * Usage:
 *   const engine = new ProactiveEngine(db, llmRegistry, notificationService);
 *   await engine.tick();           // called by recurring BullMQ job every 30 min
 *   await engine.pushCriticalInsights(newInsights);  // called by scanner on new criticals
 */
export class ProactiveEngine {
  constructor(
    private readonly db: Db,
    private readonly llmRegistry: LlmRegistry,
    private readonly notificationService: NotificationService,
  ) {}

  /** Main evaluation pass. Called by scheduled job every 30 min. */
  async tick(): Promise<{ evaluated: number; fired: ProactivePushType[] }> {
    const fired: ProactivePushType[] = [];

    // Global quiet hours guard — no proactive pushes outside work hours
    if (!isWorkHours()) {
      return { evaluated: 0, fired };
    }

    const adminUserId = await getPrimaryAdminUserId(this.db);
    if (!adminUserId) return { evaluated: 0, fired };

    const today = todayStr();
    let log: Awaited<ReturnType<typeof getProductivityLog>>;
    try {
      log = await getProductivityLog(this.db, adminUserId, today);
    } catch (err: unknown) {
      // Gracefully handle missing productivity_logs table (migration not yet run)
      if (err instanceof Error && err.message.includes("does not exist")) {
        logger.debug("productivity_logs table missing — skipping proactive tick");
        return { evaluated: 0, fired };
      }
      throw err;
    }
    const metadata = ((log?.metadata as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const pushed = this.readPushes(metadata);

    // Global daily cap
    if (pushed.length >= DAILY_PUSH_CAP) {
      logger.debug({ pushed: pushed.length, cap: DAILY_PUSH_CAP }, "daily push cap reached");
      return { evaluated: 0, fired };
    }

    // CHATTY ON (default): fires celebration, stall, and wake_up triggers
    //   throughout the active-hours window (6 AM – 10 PM). end_of_day is NOT
    //   included — the evening briefing at 20:00 already includes the
    //   productivity wrap-up and reflection prompt, so end_of_day would be
    //   a redundant extra message.
    // CHATTY OFF: only critical_insight fires (via direct call from scanner).
    const triggers: Array<() => Promise<{ fired: boolean; type?: ProactivePushType }>> = CHATTY
      ? [
          () => this.evalCelebration(adminUserId, log, pushed),
          () => this.evalStall(adminUserId, log, pushed),
          () => this.evalWakeUp(adminUserId, log, pushed),
        ]
      : [];

    let evaluated = 0;
    for (const trigger of triggers) {
      evaluated += 1;
      const result = await trigger();
      if (result.fired && result.type) {
        fired.push(result.type);
        break; // one proactive push per tick
      }
    }

    return { evaluated, fired };
  }

  /**
   * Called directly by CodebaseScannerService when a critical-severity insight
   * is discovered, so the user knows immediately instead of waiting for the tick.
   */
  async pushCriticalInsights(newCriticalCount: number, titles: string[]): Promise<boolean> {
    if (newCriticalCount === 0) return false;
    if (!isWorkHours()) return false;

    const adminUserId = await getPrimaryAdminUserId(this.db);
    if (!adminUserId) return false;

    const today = todayStr();
    const log = await getProductivityLog(this.db, adminUserId, today);
    const metadata = ((log?.metadata as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const pushed = this.readPushes(metadata);

    if (pushed.length >= DAILY_PUSH_CAP) return false;
    if (!this.canPush("critical_insight", pushed)) return false;

    const lines = [
      `**Sir, ${newCriticalCount} critical issue${newCriticalCount > 1 ? "s" : ""} in the codebase require${newCriticalCount > 1 ? "" : "s"} your attention:**`,
      "",
      ...titles.slice(0, 3).map((t) => `  • ${t}`),
      "",
      "_Auto-prioritized for today's plan._",
    ];

    await this.send(
      adminUserId,
      lines.join("\n"),
      "critical_insight",
      `${newCriticalCount} critical`,
    );
    return true;
  }

  /* ────── Triggers ────── */

  /** Wake-up: it's past 11 AM and no items have been completed yet. */
  private async evalWakeUp(
    userId: string,
    log: Awaited<ReturnType<typeof getProductivityLog>>,
    pushed: PushedRecord[],
  ): Promise<{ fired: boolean; type?: ProactivePushType }> {
    const now = new Date();
    if (now.getHours() < 11) return { fired: false };
    if (!this.canPush("wake_up", pushed)) return { fired: false };

    // Ensure a plan exists (generate one if not — no point nudging without a plan)
    let currentLog = log;
    if (!currentLog || !(currentLog.plannedItems as unknown[] | null)?.length) {
      await generateDailyPlan(this.db, this.llmRegistry, { merge: false });
      currentLog = await getProductivityLog(this.db, userId, todayStr());
    }

    const items =
      (currentLog?.plannedItems as Array<{ text: string; completed: boolean }> | null) ?? [];
    if (items.length === 0) return { fired: false };

    const completedCount = items.filter((i) => i.completed).length;
    if (completedCount > 0) return { fired: false };

    // Pick the item that looks smallest — proxy by shortest text
    const easiest = [...items.filter((i) => !i.completed)].sort(
      (a, b) => a.text.length - b.text.length,
    )[0];
    if (!easiest) return { fired: false };

    const hour = now.getHours();
    const message = [
      `**Sir, it's ${hour}:00 and nothing ticked off yet.** Might I suggest starting with the easiest item:`,
      "",
      `  → ${easiest.text}`,
      "",
      `_${items.length - completedCount} items remain on today's plan. Once you start, momentum usually follows._`,
    ].join("\n");

    await this.send(userId, message, "wake_up", `${items.length - completedCount} pending`);
    return { fired: true, type: "wake_up" };
  }

  /** Stall: 2h+ of no activity (no completed tasks, no completed follow-ups) during work hours. */
  private async evalStall(
    userId: string,
    log: Awaited<ReturnType<typeof getProductivityLog>>,
    pushed: PushedRecord[],
  ): Promise<{ fired: boolean; type?: ProactivePushType }> {
    if (!this.canPush("stall", pushed)) return { fired: false };

    // Don't fire stall in the first hour of the day — give wake_up priority
    if (isStartOfDay()) return { fired: false };

    const items = (log?.plannedItems as Array<{ text: string; completed: boolean }> | null) ?? [];
    if (items.length === 0) return { fired: false };

    const pending = items.filter((i) => !i.completed);
    if (pending.length === 0) return { fired: false };

    // Check activity in last 2 hours
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const [recentTasks, recentFus] = await Promise.all([
      listRecentlyCompletedTasks(this.db, twoHoursAgo, 5),
      listRecentlyCompletedFollowUps(this.db, twoHoursAgo, 5),
    ]);

    // Also treat plan-item completions within last 2h as activity
    const recentPlanCompletions = items.filter((i) => {
      if (!i.completed) return false;
      const ca = (i as { completedAt?: string }).completedAt;
      return ca ? new Date(ca) >= twoHoursAgo : false;
    });

    const totalActivity = recentTasks.length + recentFus.length + recentPlanCompletions.length;
    if (totalActivity > 0) return { fired: false };

    const next = pending[0];
    const message = [
      `**Sir, two hours of quiet. Still working on "${next.text}"?**`,
      "",
      `${pending.length} items remain. If that one's stuck, I can suggest a different angle — just type \`/autoplan merge:true\` and I'll find something else you can make progress on.`,
    ].join("\n");

    await this.send(userId, message, "stall", `${pending.length} pending, 2h idle`);
    return { fired: true, type: "stall" };
  }

  /** Celebration: just completed 100% of today's plan. */
  private async evalCelebration(
    userId: string,
    log: Awaited<ReturnType<typeof getProductivityLog>>,
    pushed: PushedRecord[],
  ): Promise<{ fired: boolean; type?: ProactivePushType }> {
    if (!this.canPush("celebration", pushed)) return { fired: false };

    const items = (log?.plannedItems as Array<{ text: string; completed: boolean }> | null) ?? [];
    if (items.length < 2) return { fired: false }; // at least 2 items to count as an accomplishment

    const completedCount = items.filter((i) => i.completed).length;
    if (completedCount < items.length) return { fired: false };

    const streak = log?.streakDays ?? 0;
    const score = log?.completionScore ?? 100;
    const message = [
      `**Well done, sir.** ${completedCount}/${items.length} complete for the day (${score}%).`,
      `Streak: ${streak} day${streak === 1 ? "" : "s"}.`,
      "",
      `_I can top up the plan with more work if you like — just tell me, or use \`/autoplan merge:true\`. Or use \`/reflect\` to log highlights and wrap the day._`,
    ].join("\n");

    await this.send(userId, message, "celebration", `${completedCount}/${items.length}`);
    return { fired: true, type: "celebration" };
  }

  /** End-of-day: at 17:30, push a summary and prompt for reflection. */
  private async evalEndOfDay(
    userId: string,
    log: Awaited<ReturnType<typeof getProductivityLog>>,
    pushed: PushedRecord[],
  ): Promise<{ fired: boolean; type?: ProactivePushType }> {
    const now = new Date();
    // Fire between 17:30 and 18:30
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < 17 * 60 + 30) return { fired: false };
    if (minutes > 18 * 60 + 30) return { fired: false };
    if (!this.canPush("end_of_day", pushed)) return { fired: false };

    const items = (log?.plannedItems as Array<{ text: string; completed: boolean }> | null) ?? [];
    const completedCount = items.filter((i) => i.completed).length;
    const score = log?.completionScore ?? 0;

    const lines: string[] = [];
    lines.push(
      `**End of day, sir.** ${completedCount}/${items.length} items complete (${score}%).`,
    );

    if (items.length === 0) {
      lines.push("");
      lines.push(
        "_No plan was logged today. Tomorrow I'll generate one automatically at your morning briefing._",
      );
    } else if (completedCount === items.length) {
      lines.push("");
      lines.push("_A clean sweep. Well executed._");
    } else {
      const remaining = items.filter((i) => !i.completed);
      lines.push("");
      lines.push(`_Outstanding items (${remaining.length}):_`);
      for (const r of remaining.slice(0, 3)) {
        lines.push(`  • ${r.text}`);
      }
      if (remaining.length > 3) lines.push(`  _...and ${remaining.length - 3} more_`);
    }

    lines.push("");
    lines.push(
      "_Log a quick reflection with \`/reflect\` so tomorrow's plan can learn from today._",
    );

    await this.send(userId, lines.join("\n"), "end_of_day", `${completedCount}/${items.length}`);
    return { fired: true, type: "end_of_day" };
  }

  /* ────── Internals ────── */

  private readPushes(metadata: Record<string, unknown>): PushedRecord[] {
    const raw = metadata.proactivePushes;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is PushedRecord =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Record<string, unknown>).type === "string",
    );
  }

  private canPush(type: ProactivePushType, pushed: PushedRecord[]): boolean {
    const cooldownMs = COOLDOWNS[type];
    const now = Date.now();
    for (const p of pushed) {
      if (p.type !== type) continue;
      const at = new Date(p.at).getTime();
      if (Number.isNaN(at)) continue;
      if (now - at < cooldownMs) return false;
    }
    return true;
  }

  private async send(
    userId: string,
    message: string,
    type: ProactivePushType,
    context?: string,
  ): Promise<void> {
    try {
      await this.notificationService.sendBriefing(message);
    } catch (err) {
      logger.warn({ err, type }, "proactive push send failed");
      return;
    }

    // Record the push in productivity_logs.metadata so we respect cooldowns
    try {
      const today = todayStr();
      const log = await getProductivityLog(this.db, userId, today);
      const metadata = ((log?.metadata as Record<string, unknown> | null) ?? {}) as Record<
        string,
        unknown
      >;
      const pushes = this.readPushes(metadata);
      pushes.push({ type, at: new Date().toISOString(), context });
      const newMeta: Record<string, unknown> = { ...metadata, proactivePushes: pushes };
      await upsertProductivityLog(this.db, {
        userId,
        date: today,
        streakDays: log?.streakDays ?? 0,
        metadata: newMeta,
      });
      logger.info({ type, context }, "proactive push fired");
    } catch (err) {
      logger.warn({ err, type }, "failed to record proactive push");
    }
  }
}
