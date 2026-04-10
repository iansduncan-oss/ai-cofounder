import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getProductivityLog,
  upsertProductivityLog,
  listRecentlyCompletedTasks,
  listRecentlyCompletedFollowUps,
  listFollowUps,
  listCodebaseInsights,
  getPrimaryAdminUserId,
} from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";

const logger = createLogger("plan-sync");

interface PlanItem {
  text: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
}

export interface SyncResult {
  date: string;
  autoCompleted: Array<{ itemText: string; reason: string }>;
  itemsAdded: Array<{ text: string; reason: string }>;
  completionScore: number | null;
  /** True if the plan is now empty or nearly empty — caller should consider auto-replanning. */
  needsReplan?: boolean;
  /** True if a user notification is allowed (cooldown has elapsed AND something meaningful changed). */
  shouldNotify?: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * Debounced trigger for plan sync. Call `schedule()` from any code path that
 * just completed work (task complete, follow-up done, commit, etc.) and a
 * sync will run after a short quiet period. Multiple calls collapse into one.
 */
export class PlanSyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private onTick: () => Promise<void>;
  private readonly debounceMs: number;

  constructor(onTick: () => Promise<void>, debounceMs = 15_000) {
    this.onTick = onTick;
    this.debounceMs = debounceMs;
  }

  schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire().catch((err) => {
        logger.warn({ err }, "debounced plan sync failed");
      });
    }, this.debounceMs);
    // Don't keep the process alive for this
    this.timer.unref?.();
  }

  /** Cancel any pending sync. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async fire(): Promise<void> {
    if (this.running) return; // already running; its completion will pick up any new state
    this.running = true;
    try {
      await this.onTick();
    } finally {
      this.running = false;
    }
  }
}

/** Token overlap scoring for fuzzy matching. 0..1. */
function similarityScore(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2) // drop noise words
      .filter((w) => !STOP_WORDS.has(w));
  const aTokens = new Set(normalize(a));
  const bTokens = new Set(normalize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersection += 1;
  const union = aTokens.size + bTokens.size - intersection;
  return intersection / union;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "has",
  "was", "are", "into", "our", "via", "new", "all", "any", "can", "its",
  "task", "todo", "fix", "add", "make", "use", "run", "get", "set",
]);

/** Confidence threshold for auto-marking items complete. */
const MATCH_THRESHOLD = 0.35;
const SUBSTRING_THRESHOLD_LEN = 12; // if one contains the other and both are reasonably long, treat as high-confidence

function isMatch(planText: string, completedText: string): { match: boolean; confidence: number; reason: string } {
  const a = planText.toLowerCase();
  const b = completedText.toLowerCase();

  // Direct substring match (either direction, both reasonably specific)
  if (a.length >= SUBSTRING_THRESHOLD_LEN && b.includes(a)) {
    return { match: true, confidence: 0.95, reason: "exact match in completed work" };
  }
  if (b.length >= SUBSTRING_THRESHOLD_LEN && a.includes(b)) {
    return { match: true, confidence: 0.9, reason: "plan item contained in completed work" };
  }

  const score = similarityScore(planText, completedText);
  if (score >= MATCH_THRESHOLD) {
    return { match: true, confidence: score, reason: `token similarity ${score.toFixed(2)}` };
  }
  return { match: false, confidence: score, reason: "" };
}

export interface PlanSyncOptions {
  /** How far back to look for completions. Default 60 min. */
  lookbackMinutes?: number;
  /** Also add new urgent items (overdue follow-ups, high-severity insights) to today's plan. Default true. */
  topUp?: boolean;
}

/** Minimum gap between user-facing sync notifications (ms). */
const NOTIFICATION_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Check if enough time has passed since the last sync notification to send another.
 * Also records the current time if allowed.
 */
export function shouldSendSyncNotification(metadata: Record<string, unknown> | null | undefined): boolean {
  const last = metadata?.lastSyncNotificationAt;
  if (typeof last !== "string") return true;
  const lastTime = new Date(last).getTime();
  if (Number.isNaN(lastTime)) return true;
  return Date.now() - lastTime >= NOTIFICATION_COOLDOWN_MS;
}

/**
 * Core sync: find recently-completed tasks/follow-ups and mark matching plan items done.
 * Optionally top up the plan with new urgent items that appeared mid-day.
 */
export async function syncProductivityPlan(
  db: Db,
  _llmRegistry: LlmRegistry,
  options: PlanSyncOptions = {},
): Promise<SyncResult> {
  const adminUserId = await getPrimaryAdminUserId(db);
  if (!adminUserId) {
    return { date: "", autoCompleted: [], itemsAdded: [], completionScore: null, skipped: true, reason: "no admin user" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const log = await getProductivityLog(db, adminUserId, today);

  if (!log) {
    return { date: today, autoCompleted: [], itemsAdded: [], completionScore: null, skipped: true, reason: "no plan for today" };
  }

  const currentItems: PlanItem[] = ((log.plannedItems as PlanItem[] | null) ?? []).map((i) => ({ ...i }));

  const lookback = options.lookbackMinutes ?? 60;
  const since = new Date();
  since.setMinutes(since.getMinutes() - lookback);

  const [recentTasks, recentFollowUps] = await Promise.all([
    listRecentlyCompletedTasks(db, since, 50),
    listRecentlyCompletedFollowUps(db, since, 50),
  ]);

  const autoCompleted: SyncResult["autoCompleted"] = [];

  // Try to match each pending plan item against recent completions
  for (const item of currentItems) {
    if (item.completed) continue;

    // Check tasks first (higher signal quality)
    for (const task of recentTasks) {
      const m = isMatch(item.text, task.title);
      if (m.match) {
        item.completed = true;
        item.completedBy = "task";
        item.completedAt = new Date().toISOString();
        autoCompleted.push({
          itemText: item.text,
          reason: `Matched completed task "${task.title}" (${m.reason})`,
        });
        break;
      }
    }
    if (item.completed) continue;

    // Then follow-ups
    for (const fu of recentFollowUps) {
      const m = isMatch(item.text, fu.title);
      if (m.match) {
        item.completed = true;
        item.completedBy = "follow-up";
        item.completedAt = new Date().toISOString();
        autoCompleted.push({
          itemText: item.text,
          reason: `Matched completed follow-up "${fu.title}" (${m.reason})`,
        });
        break;
      }
    }
  }

  // Top up: add new urgent items that weren't in the morning plan
  const itemsAdded: SyncResult["itemsAdded"] = [];
  if (options.topUp !== false) {
    const existingTexts = new Set(currentItems.map((i) => i.text.toLowerCase()));

    // Newly overdue follow-ups not in plan
    try {
      const pendingFollowUps = await listFollowUps(db, { status: "pending", limit: 30 });
      const now = Date.now();
      for (const fu of pendingFollowUps.data) {
        if (!fu.dueDate || fu.dueDate.getTime() > now) continue;
        const candidate = `Handle: ${fu.title}`;
        if (existingTexts.has(candidate.toLowerCase())) continue;
        // Don't spam — cap additions
        if (itemsAdded.length >= 3) break;
        currentItems.push({ text: candidate, completed: false });
        itemsAdded.push({ text: candidate, reason: `new overdue follow-up` });
        existingTexts.add(candidate.toLowerCase());
      }
    } catch (err) {
      logger.debug({ err }, "follow-up top-up failed");
    }

    // New high-severity codebase insights not in plan
    try {
      const insightList = await listCodebaseInsights(db, { status: "open", severity: "high", limit: 10 });
      for (const insight of insightList.data) {
        if (itemsAdded.length >= 5) break;
        const candidate = insight.suggestedAction ?? insight.title;
        const short = candidate.length > 100 ? candidate.slice(0, 97) + "..." : candidate;
        if (existingTexts.has(short.toLowerCase())) continue;
        currentItems.push({ text: short, completed: false });
        itemsAdded.push({ text: short, reason: `high-severity codebase insight (${insight.category})` });
        existingTexts.add(short.toLowerCase());
      }
    } catch (err) {
      logger.debug({ err }, "insight top-up failed");
    }

    // Same for critical
    try {
      const criticalList = await listCodebaseInsights(db, { status: "open", severity: "critical", limit: 5 });
      for (const insight of criticalList.data) {
        if (itemsAdded.length >= 6) break;
        const candidate = insight.suggestedAction ?? insight.title;
        const short = candidate.length > 100 ? candidate.slice(0, 97) + "..." : candidate;
        if (existingTexts.has(short.toLowerCase())) continue;
        currentItems.push({ text: short, completed: false });
        itemsAdded.push({ text: short, reason: `CRITICAL codebase insight (${insight.category})` });
        existingTexts.add(short.toLowerCase());
      }
    } catch (err) {
      logger.debug({ err }, "critical insight top-up failed");
    }
  }

  // Nothing changed → early exit, don't write
  if (autoCompleted.length === 0 && itemsAdded.length === 0) {
    const done = currentItems.filter((i) => i.completed).length;
    const remaining = currentItems.length - done;
    return {
      date: today,
      autoCompleted: [],
      itemsAdded: [],
      completionScore: log.completionScore ?? null,
      needsReplan: remaining === 0 || (remaining <= 1 && currentItems.length >= 3),
    };
  }

  // Recalculate completion score
  const done = currentItems.filter((i) => i.completed).length;
  const completionScore = currentItems.length > 0 ? Math.round((done / currentItems.length) * 100) : 0;

  // Decide whether to notify — only if something meaningful changed AND cooldown has elapsed
  const prevMeta = (log.metadata as Record<string, unknown> | null) ?? {};
  const shouldNotify = shouldSendSyncNotification(prevMeta);
  const newMeta: Record<string, unknown> = { ...prevMeta };
  if (shouldNotify) {
    newMeta.lastSyncNotificationAt = new Date().toISOString();
  }

  await upsertProductivityLog(db, {
    userId: adminUserId,
    date: today,
    plannedItems: currentItems,
    completionScore,
    streakDays: log.streakDays,
    metadata: newMeta,
  });

  // Does the plan need a top-up? Empty or one item left with hours to go.
  const remaining = currentItems.length - done;
  const hoursLeftInDay = 18 - new Date().getHours(); // EOD = 6 PM
  const needsReplan = (remaining === 0 || (remaining <= 1 && currentItems.length >= 3)) && hoursLeftInDay >= 2;

  logger.info(
    { date: today, autoCompleted: autoCompleted.length, itemsAdded: itemsAdded.length, completionScore, needsReplan, shouldNotify },
    "plan sync complete",
  );

  return {
    date: today,
    autoCompleted,
    itemsAdded,
    completionScore,
    needsReplan,
    shouldNotify,
  };
}
