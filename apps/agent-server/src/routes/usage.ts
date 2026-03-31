import type { FastifyPluginAsync } from "fastify";
import { getUsageSummary, getCostByDay, getCostByGoal, getTopExpensiveGoals, getAppSetting } from "@ai-cofounder/db";
import { optionalEnv } from "@ai-cofounder/shared";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/usage?period=today|week|month|all */
  app.get<{ Querystring: { period?: string } }>("/", { schema: { tags: ["usage"] } }, async (request) => {
    const period = (request.query.period ?? "today") as string;

    const now = new Date();
    let since: Date | undefined;

    switch (period) {
      case "today": {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      }
      case "week": {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      }
      case "month": {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      }
      case "all":
        since = undefined;
        break;
      default:
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    const summary = await getUsageSummary(app.db, since ? { since, workspaceId: request.workspaceId } : { workspaceId: request.workspaceId });
    return { period, ...summary };
  });

  /** GET /api/usage/daily?days=30 — daily cost series with zero-fill for gaps */
  app.get<{ Querystring: { days?: string } }>("/daily", { schema: { tags: ["usage"] } }, async (request) => {
    const rawDays = parseInt(request.query.days ?? "30", 10);
    const days = Math.min(isNaN(rawDays) || rawDays < 1 ? 30 : rawDays, 90);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dbRows = await getCostByDay(app.db, since, undefined, request.workspaceId);

    // Build a map from date string → row for O(1) lookup
    const byDate = new Map<string, { date: string; costUsd: number; inputTokens: number; outputTokens: number; requests: number }>();
    for (const row of dbRows) {
      byDate.set(row.date, row);
    }

    // Iterate exactly `days` calendar days from `since` and zero-fill missing entries
    const filled: Array<{ date: string; costUsd: number; inputTokens: number; outputTokens: number; requests: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const row = byDate.get(dateStr);
      if (row) {
        filled.push(row);
      } else {
        filled.push({ date: dateStr, costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 });
      }
    }

    return { days: filled };
  });

  /** GET /api/usage/budget — daily+weekly spend vs thresholds + optimization suggestions */
  app.get("/budget", { schema: { tags: ["usage"] } }, async () => {
    // DB-first: read persisted budget thresholds, fall back to env
    const [dailyDbRaw, weeklyDbRaw] = await Promise.all([
      getAppSetting(app.db, "daily_budget_usd"),
      getAppSetting(app.db, "weekly_budget_usd"),
    ]);
    const dailyLimitUsd = dailyDbRaw !== null
      ? parseFloat(dailyDbRaw)
      : parseFloat(optionalEnv("DAILY_BUDGET_USD", "0"));
    const weeklyLimitUsd = weeklyDbRaw !== null
      ? parseFloat(weeklyDbRaw)
      : parseFloat(optionalEnv("WEEKLY_BUDGET_USD", "0"));

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [dailyUsage, weeklyUsage] = await Promise.all([
      getUsageSummary(app.db, { since: todayStart }),
      getUsageSummary(app.db, { since: weekAgo }),
    ]);

    const calcPercent = (spent: number, limit: number): number | null =>
      limit > 0 ? (spent / limit) * 100 : null;

    const optimizationSuggestions = app.budgetAlertService
      ? await app.budgetAlertService.generateOptimizationSuggestions()
      : [];

    return {
      daily: {
        spentUsd: dailyUsage.totalCostUsd,
        limitUsd: dailyLimitUsd,
        percentUsed: calcPercent(dailyUsage.totalCostUsd, dailyLimitUsd),
      },
      weekly: {
        spentUsd: weeklyUsage.totalCostUsd,
        limitUsd: weeklyLimitUsd,
        percentUsed: calcPercent(weeklyUsage.totalCostUsd, weeklyLimitUsd),
      },
      optimizationSuggestions,
    };
  });

  /** GET /api/usage/by-goal/:id — cost breakdown for a specific goal */
  app.get<{ Params: { id: string } }>("/by-goal/:id", { schema: { tags: ["usage"] } }, async (request) => {
    const { id } = request.params;
    return getCostByGoal(app.db, id);
  });

  /** GET /api/usage/top-goals?limit=10&since=... — most expensive goals */
  app.get<{ Querystring: { limit?: string; since?: string } }>(
    "/top-goals",
    { schema: { tags: ["usage"] } },
    async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? "10", 10) || 10, 50);
      const since = request.query.since ? new Date(request.query.since) : undefined;
      return getTopExpensiveGoals(app.db, { limit, since: since && !isNaN(since.getTime()) ? since : undefined });
    },
  );
};
