import type { FastifyPluginAsync } from "fastify";
import { executeQueryDatabase } from "../agents/tools/database-tools.js";

export const databaseRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { sql?: string } }>(
    "/query",
    { schema: { tags: ["database"] } },
    async (request, reply) => {
      const { sql } = request.query;
      if (!sql || typeof sql !== "string" || sql.trim().length === 0) {
        return reply.status(400).send({ error: "Missing required query parameter: sql" });
      }

      const result = await executeQueryDatabase(app.db, sql);
      if ("error" in result) {
        return reply.status(400).send(result);
      }
      return result;
    },
  );
};
