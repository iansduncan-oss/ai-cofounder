import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";

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
};
