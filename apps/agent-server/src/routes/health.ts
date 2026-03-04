import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
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
};
