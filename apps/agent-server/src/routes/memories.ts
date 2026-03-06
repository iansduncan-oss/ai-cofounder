import type { FastifyPluginAsync } from "fastify";
import { listMemoriesByUser, deleteMemory } from "@ai-cofounder/db";

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { userId: string } }>("/", { schema: { tags: ["memories"] } }, async (request, reply) => {
    const { userId } = request.query;
    if (!userId) {
      return reply.status(400).send({ error: "userId query param required" });
    }
    return listMemoriesByUser(app.db, userId);
  });

  app.delete<{ Params: { id: string } }>("/:id", { schema: { tags: ["memories"] } }, async (request, reply) => {
    const result = await deleteMemory(app.db, request.params.id);
    if (!result) {
      return reply.status(404).send({ error: "Memory not found" });
    }
    return { deleted: true, id: result.id };
  });
};
