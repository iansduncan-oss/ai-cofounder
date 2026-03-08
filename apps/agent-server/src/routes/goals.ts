import type { FastifyPluginAsync } from "fastify";
import { createGoal, getGoal, listGoalsByConversation, countGoalsByConversation, updateGoalStatus } from "@ai-cofounder/db";
import { getJobStatus } from "@ai-cofounder/queue";
import { CreateGoalBody, UpdateGoalStatusBody, IdParams, GoalListQuery } from "../schemas.js";

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

  /* GET / — list goals for a conversation (paginated) */
  app.get<{ Querystring: typeof GoalListQuery.static }>(
    "/",
    { schema: { tags: ["goals"], querystring: GoalListQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const [data, total] = await Promise.all([
        listGoalsByConversation(app.db, request.query.conversationId, { limit, offset }),
        countGoalsByConversation(app.db, request.query.conversationId),
      ]);
      return { data, total, limit, offset };
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

  /* GET /:id/queue-status — query BullMQ job state for this goal */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id/queue-status",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });

      const metadata = goal.metadata as Record<string, unknown> | null;
      const jobId = metadata?.queueJobId as string | undefined;

      if (!jobId) {
        return { status: "not_queued", goalStatus: goal.status };
      }

      const jobStatus = await getJobStatus(jobId);
      if (!jobStatus) {
        return { status: "not_found", jobId };
      }

      return {
        status: jobStatus.state,
        jobId,
        attemptsMade: jobStatus.attemptsMade,
        finishedOn: jobStatus.finishedOn,
        failedReason: jobStatus.failedReason,
      };
    },
  );

  /* GET /:id/verification — get verification results */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id/verification",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });

      const metadata = goal.metadata as Record<string, unknown> | null;
      const verification = metadata?.verification;
      if (!verification) return reply.status(404).send({ error: "No verification results found" });

      return verification;
    },
  );
};
