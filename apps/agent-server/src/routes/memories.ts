import type { FastifyPluginAsync } from "fastify";
import { listMemoriesByUser, countMemoriesByUser, deleteMemory } from "@ai-cofounder/db";

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { userId: string; limit?: number; offset?: number } }>(
    "/",
    { schema: { tags: ["memories"] } },
    async (request, reply) => {
      const { userId } = request.query;
      if (!userId) {
        return reply.status(400).send({ error: "userId query param required" });
      }
      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const offset = Number(request.query.offset) || 0;
      const [data, total] = await Promise.all([
        listMemoriesByUser(app.db, userId, { limit, offset }),
        countMemoriesByUser(app.db, userId),
      ]);
      return { data, total, limit, offset };
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", { schema: { tags: ["memories"] } }, async (request, reply) => {
    const result = await deleteMemory(app.db, request.params.id);
    if (!result) {
      return reply.status(404).send({ error: "Memory not found" });
    }
    return { deleted: true, id: result.id };
  });
};
