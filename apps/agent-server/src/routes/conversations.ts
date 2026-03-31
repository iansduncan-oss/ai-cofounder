import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  searchMessages,
  listConversationsByUser,
  getConversation,
  getConversationMessages,
  listGoalsByConversation,
  deleteConversation,
} from "@ai-cofounder/db";
import { IdParams, PaginationQuery } from "../schemas.js";

const SearchQuery = Type.Intersect([
  Type.Object({
    q: Type.String({ minLength: 1, maxLength: 500 }),
    conversationId: Type.Optional(Type.String({ format: "uuid" })),
    role: Type.Optional(
      Type.Union([Type.Literal("user"), Type.Literal("agent"), Type.Literal("system")]),
    ),
  }),
  PaginationQuery,
]);

const UserConversationsQuery = Type.Intersect([
  Type.Object({ userId: Type.String({ format: "uuid" }) }),
  PaginationQuery,
]);

const MessagesQuery = PaginationQuery;

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  /* GET /search — search across all messages */
  app.get<{ Querystring: typeof SearchQuery.static }>(
    "/search",
    { schema: { tags: ["conversations"], querystring: SearchQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const { data, total } = await searchMessages(app.db, request.query.q, {
        conversationId: request.query.conversationId,
        role: request.query.role,
        limit,
        offset,
      });
      return { data, total, limit, offset };
    },
  );

  /* GET / — list conversations for a user */
  app.get<{ Querystring: typeof UserConversationsQuery.static }>(
    "/",
    { schema: { tags: ["conversations"], querystring: UserConversationsQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const { data, total } = await listConversationsByUser(app.db, request.query.userId, {
        limit,
        offset,
        workspaceId: request.workspaceId,
      });
      return { data, total, limit, offset };
    },
  );

  /* GET /:id — get a single conversation */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["conversations"], params: IdParams } },
    async (request, reply) => {
      const conv = await getConversation(app.db, request.params.id, request.workspaceId);
      if (!conv) return reply.status(404).send({ error: "Conversation not found" });
      return conv;
    },
  );

  /* GET /:id/export — export full conversation as JSON */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id/export",
    { schema: { tags: ["conversations"], params: IdParams } },
    async (request, reply) => {
      const conv = await getConversation(app.db, request.params.id);
      if (!conv) return reply.status(404).send({ error: "Conversation not found" });

      const messages = await getConversationMessages(app.db, request.params.id, 10_000, 0);
      const goals = await listGoalsByConversation(app.db, request.params.id, { limit: 1000 });

      const exportData = {
        exportedAt: new Date().toISOString(),
        conversation: conv,
        messages: messages.reverse(),
        goals,
      };

      reply
        .header("Content-Disposition", `attachment; filename=conversation-${request.params.id}.json`)
        .type("application/json")
        .send(JSON.stringify(exportData, null, 2));
    },
  );

  /* DELETE /:id — delete a conversation (CASCADE handles messages, goals, etc.) */
  app.delete<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["conversations"], params: IdParams } },
    async (request, reply) => {
      const row = await deleteConversation(app.db, request.params.id);
      if (!row) return reply.status(404).send({ error: "Conversation not found" });
      app.wsBroadcast?.("conversations");
      return { deleted: true, id: request.params.id };
    },
  );

  /* GET /:id/messages — list messages for a conversation */
  app.get<{ Params: typeof IdParams.static; Querystring: typeof MessagesQuery.static }>(
    "/:id/messages",
    { schema: { tags: ["conversations"], params: IdParams, querystring: MessagesQuery } },
    async (request, reply) => {
      const conv = await getConversation(app.db, request.params.id);
      if (!conv) return reply.status(404).send({ error: "Conversation not found" });

      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const data = await getConversationMessages(app.db, request.params.id, limit, offset);
      return { data, limit, offset };
    },
  );
};
