import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import { enqueueReflection } from "@ai-cofounder/queue";
import {
  listReflections,
  getReflection,
  getReflectionStats,
} from "@ai-cofounder/db";

export async function reflectionRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/reflections — list reflections with optional type filter
  app.get<{
    Querystring: { type?: string; limit?: string; offset?: string };
  }>("/", async (request) => {
    const type = request.query.type as "goal_completion" | "failure_analysis" | "pattern_extraction" | "weekly_summary" | undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;

    const result = await listReflections(app.db, { type, limit, offset });
    return result;
  });

  // GET /api/reflections/stats — aggregate stats
  app.get("/stats", async () => {
    const stats = await getReflectionStats(app.db);
    return { stats };
  });

  // GET /api/reflections/:id — single reflection
  app.get<{
    Params: { id: string };
  }>("/:id", async (request, reply) => {
    const reflection = await getReflection(app.db, request.params.id);
    if (!reflection) {
      return reply.status(404).send({ error: "Reflection not found" });
    }
    return reflection;
  });

  // POST /api/reflections/weekly — manually trigger weekly pattern extraction
  app.post("/weekly", async (_request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }

    const jobId = await enqueueReflection({ action: "weekly_patterns" });
    return { jobId, action: "weekly_patterns" };
  });
}
