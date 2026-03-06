import type { FastifyPluginAsync } from "fastify";
import { getUsageSummary } from "@ai-cofounder/db";

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

    const summary = await getUsageSummary(app.db, since ? { since } : undefined);
    return { period, ...summary };
  });
};
