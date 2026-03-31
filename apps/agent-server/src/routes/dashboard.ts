import type { FastifyPluginAsync } from "fastify";
import {
  listActiveGoals,
  countTasksByStatus,
  listEvents,
  getUsageSummary,
} from "@ai-cofounder/db";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  /* GET /summary — aggregated dashboard data */
  app.get("/summary", { schema: { tags: ["dashboard"] } }, async (request) => {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeGoals,
      taskStatusCounts,
      recentEvents,
      costToday,
      costWeek,
      costMonth,
    ] = await Promise.all([
      listActiveGoals(app.db, request.workspaceId),
      countTasksByStatus(app.db, request.workspaceId),
      listEvents(app.db, { limit: 10 }),
      getUsageSummary(app.db, { since: todayStart, workspaceId: request.workspaceId }),
      getUsageSummary(app.db, { since: weekStart, workspaceId: request.workspaceId }),
      getUsageSummary(app.db, { since: monthStart, workspaceId: request.workspaceId }),
    ]);

    const providerHealth = app.llmRegistry.getProviderHealth();

    return {
      goals: {
        activeCount: activeGoals.length,
        recent: activeGoals.slice(0, 5),
      },
      tasks: {
        pendingCount: taskStatusCounts["pending"] ?? 0,
        runningCount: taskStatusCounts["running"] ?? 0,
        completedCount: taskStatusCounts["completed"] ?? 0,
        failedCount: taskStatusCounts["failed"] ?? 0,
      },
      providerHealth,
      costs: {
        today: costToday.totalCostUsd,
        week: costWeek.totalCostUsd,
        month: costMonth.totalCostUsd,
      },
      recentEvents,
    };
  });
};
