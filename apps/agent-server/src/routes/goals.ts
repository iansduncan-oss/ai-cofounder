import type { FastifyPluginAsync } from "fastify";
import { createGoal, getGoal, listGoalsByConversation, updateGoalStatus } from "@ai-cofounder/db";
import { CreateGoalBody, UpdateGoalStatusBody, IdParams, ConversationIdQuery } from "../schemas.js";

export const goalRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create a goal */
  app.post<{ Body: typeof CreateGoalBody.static }>(
    "/",
    { schema: { tags: ["goals"], body: CreateGoalBody } },
    async (request, reply) => {
      const goal = await createGoal(app.db, request.body);
      return reply.status(201).send(goal);
    },
  );

  /* GET /:id — get a single goal */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      return goal;
    },
  );

  /* GET / — list goals for a conversation */
  app.get<{ Querystring: typeof ConversationIdQuery.static }>(
    "/",
    { schema: { tags: ["goals"], querystring: ConversationIdQuery } },
    async (request) => {
      return listGoalsByConversation(app.db, request.query.conversationId);
    },
  );

  /* PATCH /:id/status — update goal status */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof UpdateGoalStatusBody.static;
  }>(
    "/:id/status",
    { schema: { tags: ["goals"], params: IdParams, body: UpdateGoalStatusBody } },
    async (request, reply) => {
      const goal = await updateGoalStatus(app.db, request.params.id, request.body.status);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      return goal;
    },
  );
};
