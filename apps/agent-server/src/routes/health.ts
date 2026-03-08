import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { getProviderHealthHistory, getToolStats } from "@ai-cofounder/db";
import { gatherBriefingData, formatBriefing, sendDailyBriefing } from "../services/briefing.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", { schema: { tags: ["health"] } }, async (_request, reply) => {
    try {
      await app.db.execute(sql`SELECT 1`);
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      };
    } catch {
      reply.code(503);
      return {
        status: "degraded",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        error: "database unreachable",
      };
    }
  });

  /** GET /health/providers — LLM provider health status */
  app.get("/health/providers", { schema: { tags: ["health"] } }, async () => {
    const providers = app.llmRegistry.getProviderHealth();
    const allAvailable = providers.every((p) => p.available);
    return {
      status: allAvailable ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      providers,
    };
  });

  /** GET /health/providers/history — persisted provider health data */
  app.get<{ Querystring: { provider?: string } }>(
    "/health/providers/history",
    { schema: { tags: ["health"] } },
    async (request) => {
      const { provider } = request.query;
      const records = await getProviderHealthHistory(app.db, provider);
      return {
        timestamp: new Date().toISOString(),
        records,
      };
    },
  );

  /** GET /api/tools/stats — per-tool execution timing stats */
  app.get("/api/tools/stats", { schema: { tags: ["health"] } }, async () => {
    const stats = await getToolStats(app.db);
    return {
      timestamp: new Date().toISOString(),
      tools: stats,
    };
  });

  /** GET /api/briefing — generate and optionally send the daily briefing */
  app.get<{ Querystring: { send?: string } }>(
    "/api/briefing",
    { schema: { tags: ["health"] } },
    async (request) => {
      const shouldSend = request.query.send === "true";

      if (shouldSend) {
        const text = await sendDailyBriefing(app.db, app.notificationService);
        return { sent: true, briefing: text };
      }

      const data = await gatherBriefingData(app.db);
      const text = formatBriefing(data);
      return { sent: false, briefing: text, data };
    },
  );
};
