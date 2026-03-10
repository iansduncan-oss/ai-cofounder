import type { FastifyPluginAsync } from "fastify";
import {
  listAgentMessages,
  getAgentMessage,
  getMessageThread,
  listGoalMessages,
  getAgentMessageStats,
} from "@ai-cofounder/db";

export const agentMessageRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list with filters */
  app.get<{
    Querystring: {
      goalId?: string;
      role?: string;
      type?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>("/", { schema: { tags: ["agent-messages"] } }, async (request) => {
    const { goalId, role, type, status, limit, offset } = request.query;
    return listAgentMessages(app.db, {
      goalId,
      role,
      messageType: type,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  });

  /* GET /stats — aggregate counts */
  app.get("/stats", { schema: { tags: ["agent-messages"] } }, async () => {
    return getAgentMessageStats(app.db);
  });

  /* GET /thread/:correlationId — request-response thread */
  app.get<{ Params: { correlationId: string } }>(
    "/thread/:correlationId",
    { schema: { tags: ["agent-messages"] } },
    async (request) => {
      return getMessageThread(app.db, request.params.correlationId);
    },
  );

  /* GET /goal/:goalId — all messages for a goal */
  app.get<{
    Params: { goalId: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    "/goal/:goalId",
    { schema: { tags: ["agent-messages"] } },
    async (request) => {
      const { limit, offset } = request.query;
      return listGoalMessages(app.db, request.params.goalId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    },
  );

  /* GET /:id — single message */
  app.get<{ Params: { id: string } }>(
    "/:id",
    { schema: { tags: ["agent-messages"] } },
    async (request, reply) => {
      const msg = await getAgentMessage(app.db, request.params.id);
      if (!msg) return reply.status(404).send({ error: "Message not found" });
      return msg;
    },
  );
};
