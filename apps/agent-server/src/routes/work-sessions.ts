import type { FastifyPluginAsync } from "fastify";
import { listWorkSessionsFiltered, getWorkSession, cancelWorkSession } from "@ai-cofounder/db";

export const workSessionRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list work sessions (paginated) */
  app.get<{ Querystring: { limit?: string; offset?: string; goalId?: string } }>(
    "/",
    { schema: { tags: ["work-sessions"] } },
    async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? "50", 10) || 50, 200);
      const offset = parseInt(request.query.offset ?? "0", 10) || 0;
      const { goalId } = request.query;
      return listWorkSessionsFiltered(app.db, { limit, offset, goalId });
    },
  );

  /* GET /:id — single work session */
  app.get<{ Params: { id: string } }>(
    "/:id",
    { schema: { tags: ["work-sessions"] } },
    async (request, reply) => {
      const session = await getWorkSession(app.db, request.params.id);
      if (!session) return reply.status(404).send({ error: "Work session not found" });
      return session;
    },
  );

  /* PATCH /:id/cancel — cancel a running session */
  app.patch<{ Params: { id: string } }>(
    "/:id/cancel",
    { schema: { tags: ["work-sessions"] } },
    async (request, reply) => {
      const session = await cancelWorkSession(app.db, request.params.id);
      if (!session) return reply.status(404).send({ error: "Work session not found or not running" });
      app.wsBroadcast?.("work-sessions");
      return session;
    },
  );
};
