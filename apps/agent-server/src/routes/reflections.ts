import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueueReflection } from "@ai-cofounder/queue";
import {
  listReflections,
  getReflection,
  getReflectionStats,
} from "@ai-cofounder/db";
import { ReflectionListQuery, IdParams } from "../schemas.js";

export async function reflectionRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/reflections — list reflections with optional type filter
  app.get<{ Querystring: typeof ReflectionListQuery.static }>(
    "/",
    { schema: { tags: ["reflections"], querystring: ReflectionListQuery } },
    async (request) => {
      const type = request.query.type;
      const limit = request.query.limit ?? 50;
      const offset = request.query.offset ?? 0;

      const result = await listReflections(app.db, { type, limit, offset });
      return result;
    },
  );

  // GET /api/reflections/stats — aggregate stats
  app.get("/stats", { schema: { tags: ["reflections"] } }, async () => {
    const stats = await getReflectionStats(app.db);
    return { stats };
  });

  // GET /api/reflections/:id — single reflection
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["reflections"], params: IdParams } },
    async (request, reply) => {
      const reflection = await getReflection(app.db, request.params.id);
      if (!reflection) {
        return reply.status(404).send({ error: "Reflection not found" });
      }
      return reflection;
    },
  );

  // POST /api/reflections/weekly — manually trigger weekly pattern extraction
  app.post("/weekly", { schema: { tags: ["reflections"] } }, async (_request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const jobId = await enqueueReflection({ action: "weekly_patterns" });
    return { jobId, action: "weekly_patterns" };
  });
}
