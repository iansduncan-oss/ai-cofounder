import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { createGoal, getGoal, listGoalsByConversation, countGoalsByConversation, updateGoalStatus, listTasksByGoal, tasks, deleteGoal, cancelGoal, getGoalAnalytics } from "@ai-cofounder/db";
import { getJobStatus } from "@ai-cofounder/queue";
import { CreateGoalBody, UpdateGoalStatusBody, BulkGoalStatusBody, IdParams, GoalListQuery } from "../schemas.js";
import { recordActionSafe } from "../services/action-recorder.js";

const logger = createLogger("goal-routes");

export const goalRoutes: FastifyPluginAsync = async (app) => {
  /* GET /analytics — goal performance metrics */
  app.get(
    "/analytics",
    { schema: { tags: ["goals"] } },
    async () => getGoalAnalytics(app.db),
  );

  /* POST / — create a goal */
  app.post<{ Body: typeof CreateGoalBody.static }>(
    "/",
    { schema: { tags: ["goals"], body: CreateGoalBody } },
    async (request, reply) => {
      const goal = await createGoal(app.db, request.body);
      app.wsBroadcast?.("goals");
      recordActionSafe(app.db, {
        userId: request.body.createdBy,
        actionType: "goal_created",
        actionDetail: request.body.title.slice(0, 200),
      });
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
      app.wsBroadcast?.("goals");
      return goal;
    },
  );

  /* PATCH /bulk-status — update status for multiple goals */
  app.patch<{ Body: typeof BulkGoalStatusBody.static }>(
    "/bulk-status",
    { schema: { tags: ["goals"], body: BulkGoalStatusBody } },
    async (request) => {
      const results = await Promise.all(
        request.body.updates.map(({ id, status }) => updateGoalStatus(app.db, id, status)),
      );
      const updated = results.filter(Boolean).length;
      if (updated > 0) app.wsBroadcast?.("goals");
      return { updated };
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

  /* POST /:id/clone — duplicate a goal with its tasks */
  app.post<{ Params: typeof IdParams.static }>(
    "/:id/clone",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const original = await getGoal(app.db, request.params.id);
      if (!original) return reply.status(404).send({ error: "Goal not found" });

      const cloned = await createGoal(app.db, {
        conversationId: original.conversationId,
        title: `${original.title} (copy)`,
        description: original.description ?? undefined,
        priority: original.priority,
        milestoneId: original.milestoneId ?? undefined,
      });

      // Clone all tasks with reset statuses (batch insert)
      const originalTasks = await listTasksByGoal(app.db, original.id);
      if (originalTasks.length > 0) {
        await app.db.insert(tasks).values(
          originalTasks.map((task) => ({
            goalId: cloned.id,
            title: task.title,
            description: task.description,
            assignedAgent: task.assignedAgent,
            orderIndex: task.orderIndex,
            parallelGroup: task.parallelGroup,
            input: task.input,
          })),
        );
      }

      return reply.status(201).send(cloned);
    },
  );

  /* POST /:id/approve — approve a proposed goal for execution */
  app.post<{ Params: typeof IdParams.static }>(
    "/:id/approve",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      if (goal.status !== "proposed") {
        return reply.status(409).send({ error: `Cannot approve goal with status "${goal.status}" — must be "proposed"` });
      }

      const updated = await updateGoalStatus(app.db, goal.id, "active");
      logger.info({ goalId: goal.id }, "Proposed goal approved");

      if (app.wsBroadcast) {
        app.wsBroadcast("goals");
      }

      return updated;
    },
  );

  /* POST /:id/reject — reject a proposed goal */
  app.post<{ Params: typeof IdParams.static; Body: { reason?: string } }>(
    "/:id/reject",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      if (goal.status !== "proposed") {
        return reply.status(409).send({ error: `Cannot reject goal with status "${goal.status}" — must be "proposed"` });
      }

      const updated = await updateGoalStatus(app.db, goal.id, "cancelled");
      logger.info({ goalId: goal.id, reason: request.body?.reason }, "Proposed goal rejected");

      if (app.wsBroadcast) {
        app.wsBroadcast("goals");
      }

      return updated;
    },
  );

  /* DELETE /:id — delete a goal (CASCADE handles tasks) */
  app.delete<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const row = await deleteGoal(app.db, request.params.id);
      if (!row) return reply.status(404).send({ error: "Goal not found" });
      app.wsBroadcast?.("goals");
      return { deleted: true, id: request.params.id };
    },
  );

  /* PATCH /:id/cancel — cancel a goal and all pending/running tasks */
  app.patch<{ Params: typeof IdParams.static }>(
    "/:id/cancel",
    { schema: { tags: ["goals"], params: IdParams } },
    async (request, reply) => {
      const goal = await cancelGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      app.wsBroadcast?.("goals");
      return goal;
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
