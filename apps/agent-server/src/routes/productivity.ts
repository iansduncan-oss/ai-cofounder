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

const logger = createLogger("productivity-routes");

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
