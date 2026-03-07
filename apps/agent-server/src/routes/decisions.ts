import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import { listDecisions, saveMemory } from "@ai-cofounder/db";
import { PaginationQuery } from "../schemas.js";

const DecisionListQuery = Type.Intersect([
  Type.Object({
    userId: Type.String({ format: "uuid" }),
    q: Type.Optional(Type.String({ maxLength: 500 })),
  }),
  PaginationQuery,
]);

const CreateDecisionBody = Type.Object({
  userId: Type.String({ format: "uuid" }),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  decision: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String()),
  alternatives: Type.Optional(Type.Array(Type.String())),
  rationale: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
});

export const decisionRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list decisions for a user */
  app.get<{ Querystring: typeof DecisionListQuery.static }>(
    "/",
    { schema: { tags: ["decisions"], querystring: DecisionListQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const { data, total } = await listDecisions(app.db, request.query.userId, {
        query: request.query.q,
        limit,
        offset,
      });
      return { data, total, limit, offset };
    },
  );

  /* POST / — record a decision */
  app.post<{ Body: typeof CreateDecisionBody.static }>(
    "/",
    { schema: { tags: ["decisions"], body: CreateDecisionBody } },
    async (request, reply) => {
      const { userId, title, decision, context, alternatives, rationale, source } = request.body;

      const memory = await saveMemory(app.db, {
        userId,
        category: "decisions",
        key: title,
        content: decision,
        source,
        metadata: {
          context,
          alternatives,
          rationale,
          recordedAt: new Date().toISOString(),
        },
      });

      return reply.status(201).send(memory);
    },
  );
};
