import type { FastifyPluginAsync } from "fastify";
import { listMemoriesByUser, countMemoriesByUser, deleteMemory, saveMemory } from "@ai-cofounder/db";

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
        listMemoriesByUser(app.db, userId, { limit, offset, workspaceId: request.workspaceId }),
        countMemoriesByUser(app.db, userId),
      ]);
      return { data, total, limit, offset };
    },
  );

  app.post<{
    Body: {
      userId: string;
      category: string;
      key: string;
      content: string;
      source?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    "/",
    { schema: { tags: ["memories"] } },
    async (request, reply) => {
      const { userId, category, key, content, source, metadata } = request.body;
      if (!userId || !category || !key || !content) {
        return reply.status(400).send({ error: "userId, category, key, and content are required" });
      }

      const validCategories = ["user_info", "preferences", "projects", "decisions", "goals", "technical", "business", "other"];
      if (!validCategories.includes(category)) {
        return reply.status(400).send({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
      }

      const embedding = app.embeddingService
        ? await app.embeddingService.embed(content.slice(0, 4000))
        : undefined;

      const result = await saveMemory(app.db, {
        userId,
        category: category as "user_info" | "preferences" | "projects" | "decisions" | "goals" | "technical" | "business" | "other",
        key,
        content,
        source: source ?? "claude-code",
        agentRole: "external",
        metadata,
        embedding,
      });

      return reply.status(201).send(result);
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
