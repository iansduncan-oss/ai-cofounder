import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import {
  upsertProductivityLog,
  getProductivityLog,
  listProductivityLogs,
  getProductivityStats,
  deleteProductivityLog,
} from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";
import { generateDailyPlan } from "../services/auto-planner.js";
import { syncProductivityPlan, PlanSyncScheduler } from "../services/plan-sync.js";

const logger = createLogger("productivity-routes");

declare module "fastify" {
  interface FastifyInstance {
    /** Debounced sync scheduler. Call `app.planSync.schedule()` after any work completion
     *  to trigger a plan sync ~15s later (multiple calls collapse into one). */
    planSync: PlanSyncScheduler;
  }
}

const PlannedItem = Type.Object({
  text: Type.String(),
  completed: Type.Boolean(),
});

const UpsertBody = Type.Object({
  date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  plannedItems: Type.Optional(Type.Array(PlannedItem)),
  reflectionNotes: Type.Optional(Type.String()),
  mood: Type.Optional(Type.Union([
    Type.Literal("great"),
    Type.Literal("good"),
    Type.Literal("okay"),
    Type.Literal("rough"),
    Type.Literal("terrible"),
  ])),
  energyLevel: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  highlights: Type.Optional(Type.String()),
  blockers: Type.Optional(Type.String()),
});
type UpsertBody = Static<typeof UpsertBody>;

export async function productivityRoutes(app: FastifyInstance): Promise<void> {
  // Install debounced sync scheduler (lazy singleton per-app)
  if (!app.planSync) {
    const scheduler = new PlanSyncScheduler(async () => {
      try {
        const result = await syncProductivityPlan(app.db, app.llmRegistry, { lookbackMinutes: 15 });
        if (result.skipped) return;
        const changed = result.autoCompleted.length > 0 || result.itemsAdded.length > 0;
        if (changed) {
          app.wsBroadcast?.("productivity");
        }

        // Dynamic replanning: if the plan is empty or nearly done and there's time left, auto-generate more
        if (result.needsReplan) {
          logger.info({ date: result.date }, "plan complete — auto-generating top-up");
          const replan = await generateDailyPlan(app.db, app.llmRegistry, { merge: true });
          if (!replan.skipped && replan.plannedItems.length > 0) {
            app.wsBroadcast?.("productivity");
          }
        }

        // Only notify if sync explicitly marked it shouldNotify (cooldown respected) AND something meaningful happened
        if (changed && result.shouldNotify) {
          const { getNotificationQueue } = await import("@ai-cofounder/queue");
          const parts: string[] = [];
          if (result.autoCompleted.length > 0) {
            parts.push(`**${result.autoCompleted.length} auto-completed:**`);
            for (const c of result.autoCompleted.slice(0, 3)) {
              parts.push(`  [x] ${c.itemText}`);
            }
          }
          if (result.itemsAdded.length > 0) {
            parts.push(`**${result.itemsAdded.length} added:**`);
            for (const a of result.itemsAdded.slice(0, 3)) {
              parts.push(`  - ${a.text}`);
            }
          }
          if (result.completionScore != null) {
            parts.push(`\n_Completion: ${result.completionScore}%_`);
          }
          await getNotificationQueue().add("productivity-sync", {
            channel: "all",
            type: "info",
            title: "Plan updated",
            message: parts.join("\n"),
          });
        }
      } catch (err) {
        logger.warn({ err }, "debounced plan sync failed");
      }
    }, 15_000);

    app.decorate("planSync", scheduler);
    app.addHook("onClose", async () => scheduler.cancel());
  }

  // PUT /api/productivity — upsert today's log (check-in or reflection)
  app.put<{ Body: UpsertBody }>("/", { schema: { body: UpsertBody } }, async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const body = request.body;

    // Auto-calculate completion score from planned items
    let completionScore: number | undefined;
    if (body.plannedItems && body.plannedItems.length > 0) {
      const completed = body.plannedItems.filter((i) => i.completed).length;
      completionScore = Math.round((completed / body.plannedItems.length) * 100);
    }

    // Calculate streak: check if yesterday also has a log
    let streakDays = 1;
    const yesterday = new Date(body.date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const prevLog = await getProductivityLog(app.db, userId, yesterdayStr);
    if (prevLog) {
      streakDays = prevLog.streakDays + 1;
    }

    const row = await upsertProductivityLog(app.db, {
      userId,
      date: body.date,
      plannedItems: body.plannedItems,
      reflectionNotes: body.reflectionNotes,
      mood: body.mood,
      energyLevel: body.energyLevel,
      completionScore,
      streakDays,
      highlights: body.highlights,
      blockers: body.blockers,
    });

    app.wsBroadcast?.("productivity");
    return row;
  });

  // GET /api/productivity/today — get today's log
  app.get("/today", async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const today = new Date().toISOString().slice(0, 10);
    const row = await getProductivityLog(app.db, userId, today);
    return row ?? { date: today, plannedItems: [], streakDays: 0 };
  });

  // GET /api/productivity/history — get log history
  app.get("/history", async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const { limit, offset, from, to } = request.query as {
      limit?: string;
      offset?: string;
      from?: string;
      to?: string;
    };
    return listProductivityLogs(app.db, userId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      from,
      to,
    });
  });

  // GET /api/productivity/stats — aggregated stats (streaks, averages, trends)
  app.get("/stats", async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const { days } = request.query as { days?: string };
    return getProductivityStats(app.db, userId, days ? Number(days) : 30);
  });

  // POST /api/productivity/auto-plan — generate today's plan from goals/tasks/follow-ups
  // Body: { force?: boolean, merge?: boolean }
  //   force=true: overwrite existing plan for today
  //   merge=true: append new items to existing plan (dedupe by text)
  //   default: skip if plan already exists
  app.post("/auto-plan", async (request) => {
    const { force, merge } = (request.body ?? {}) as { force?: boolean; merge?: boolean };
    const result = await generateDailyPlan(app.db, app.llmRegistry, { force, merge });
    app.wsBroadcast?.("productivity");
    return result;
  });

  // GET /api/productivity/next — return the next incomplete plan item with context.
  // If the plan is empty or all done, auto-generates a plan (merge mode).
  app.get("/next", async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const today = new Date().toISOString().slice(0, 10);
    let log = await getProductivityLog(app.db, userId, today);

    const pending = (log?.plannedItems as Array<{ text: string; completed: boolean }> | null ?? []).filter((i) => !i.completed);

    if (pending.length === 0) {
      // Auto-replan on the fly
      logger.info({ date: today }, "no pending items — auto-generating plan for /next");
      const replan = await generateDailyPlan(app.db, app.llmRegistry, { merge: true });
      if (!replan.skipped && replan.plannedItems.length > 0) {
        log = await getProductivityLog(app.db, userId, today);
      }
    }

    const updatedPending = (log?.plannedItems as Array<{ text: string; completed: boolean }> | null ?? []).filter((i) => !i.completed);
    const next = updatedPending[0] ?? null;
    const totalItems = (log?.plannedItems as Array<unknown> | null ?? []).length;
    const completedCount = totalItems - updatedPending.length;

    return {
      date: today,
      next,
      remaining: updatedPending.length,
      total: totalItems,
      completed: completedCount,
      completionScore: log?.completionScore ?? null,
      streakDays: log?.streakDays ?? 0,
      allDone: updatedPending.length === 0 && totalItems > 0,
    };
  });

  // POST /api/productivity/proactive-check — manually trigger the proactive engine tick.
  // Normally runs every 30 min automatically; this endpoint is for testing / forcing it.
  app.post("/proactive-check", async () => {
    const { ProactiveEngine } = await import("../services/proactive-engine.js");
    const engine = new ProactiveEngine(app.db, app.llmRegistry, app.notificationService);
    const result = await engine.tick();
    if (result.fired.length > 0) app.wsBroadcast?.("productivity");
    return result;
  });

  // POST /api/productivity/sync — auto-mark completed items and top up with new urgent work
  // Body: { lookbackMinutes?: number, topUp?: boolean }
  app.post("/sync", async (request) => {
    const { lookbackMinutes, topUp } = (request.body ?? {}) as {
      lookbackMinutes?: number;
      topUp?: boolean;
    };
    const result = await syncProductivityPlan(app.db, app.llmRegistry, { lookbackMinutes, topUp });
    if (!result.skipped) app.wsBroadcast?.("productivity");
    return result;
  });

  // GET /api/productivity/weekly — LLM-generated weekly reflection
  app.get("/weekly", async (request) => {
    const userId = (request.user as { sub: string }).sub;
    const stats = await getProductivityStats(app.db, userId, 7);
    const logs = await listProductivityLogs(app.db, userId, { limit: 7 });

    // Build a compact data summary for the LLM
    const entries = logs.data.map((l) => {
      const items = (l.plannedItems as { text: string; completed: boolean }[] | null) ?? [];
      const done = items.filter((i) => i.completed).map((i) => i.text);
      const missed = items.filter((i) => !i.completed).map((i) => i.text);
      return {
        date: l.date,
        mood: l.mood,
        energy: l.energyLevel,
        completion: l.completionScore,
        done,
        missed,
        highlights: l.highlights,
        blockers: l.blockers,
      };
    });

    const prompt = [
      "Generate a weekly productivity reflection based on the last 7 days of data.",
      "Tone: Jarvis from Iron Man — composed, British, measured. Address the user as 'sir'.",
      "Structure: (1) one-line overall summary, (2) wins and patterns, (3) areas to watch, (4) one actionable suggestion for next week.",
      "Keep it under 400 words. Use markdown.",
      "",
      `**Stats:** ${stats.totalDays} days tracked, ${stats.avgCompletion}% avg completion, ${stats.avgEnergy}/5 avg energy, current streak: ${stats.currentStreak} day(s)`,
      `**Mood distribution:** ${JSON.stringify(stats.moodCounts)}`,
      "",
      "**Daily entries:**",
      JSON.stringify(entries, null, 2),
    ].join("\n");

    try {
      const response = await app.llmRegistry.complete("simple", {
        system:
          "You are Jarvis, a composed British AI assistant helping the user reflect on their week. " +
          "Be insightful, honest, and constructive. No exclamation marks.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      });
      const text = response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { summary: text, stats, entryCount: entries.length };
    } catch (err) {
      logger.warn({ err }, "weekly summary LLM call failed");
      return {
        summary: `**Weekly Summary (${entries.length} days)**\nAvg completion: ${stats.avgCompletion}%\nCurrent streak: ${stats.currentStreak} day(s)`,
        stats,
        entryCount: entries.length,
      };
    }
  });

  // DELETE /api/productivity/:id — delete a log
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await deleteProductivityLog(app.db, id);
    if (!row) return reply.status(404).send({ error: "Productivity log not found" });
    app.wsBroadcast?.("productivity");
    return { deleted: true, id };
  });
}
