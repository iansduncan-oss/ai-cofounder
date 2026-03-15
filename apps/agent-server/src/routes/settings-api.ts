import type { FastifyPluginAsync } from "fastify";
import { getAppSetting, upsertAppSetting } from "@ai-cofounder/db";
import { optionalEnv } from "@ai-cofounder/shared";

const DAILY_KEY = "daily_budget_usd";
const WEEKLY_KEY = "weekly_budget_usd";

export const settingsApiRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/settings — returns persisted app settings (DB-first, env-fallback) */
  app.get("/", { schema: { tags: ["settings"] } }, async () => {
    const [dailyRaw, weeklyRaw] = await Promise.all([
      getAppSetting(app.db, DAILY_KEY),
      getAppSetting(app.db, WEEKLY_KEY),
    ]);

    const envDailyFallback = parseFloat(optionalEnv("DAILY_BUDGET_USD", "0"));
    const envWeeklyFallback = parseFloat(optionalEnv("WEEKLY_BUDGET_USD", "0"));

    const dailyBudgetUsd = dailyRaw !== null ? parseFloat(dailyRaw) : envDailyFallback;
    const weeklyBudgetUsd = weeklyRaw !== null ? parseFloat(weeklyRaw) : envWeeklyFallback;

    return { dailyBudgetUsd, weeklyBudgetUsd };
  });

  /** PUT /api/settings/budget — persist budget thresholds */
  app.put<{
    Body: { dailyUsd: number; weeklyUsd: number };
  }>(
    "/budget",
    { schema: { tags: ["settings"] } },
    async (request, reply) => {
      const { dailyUsd, weeklyUsd } = request.body;

      if (typeof dailyUsd !== "number" || dailyUsd < 0) {
        return reply.status(400).send({ error: "dailyUsd must be a non-negative number" });
      }
      if (typeof weeklyUsd !== "number" || weeklyUsd < 0) {
        return reply.status(400).send({ error: "weeklyUsd must be a non-negative number" });
      }

      await Promise.all([
        upsertAppSetting(app.db, DAILY_KEY, String(dailyUsd)),
        upsertAppSetting(app.db, WEEKLY_KEY, String(weeklyUsd)),
      ]);

      return { ok: true, dailyBudgetUsd: dailyUsd, weeklyBudgetUsd: weeklyUsd };
    },
  );
};
