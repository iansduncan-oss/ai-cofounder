import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import {
  createGoal,
  getGoal,
  listGoalsByConversation,
  countGoalsByConversation,
  updateGoalStatus,
  listTasksByGoal,
  tasks,
  deleteGoal,
  cancelGoal,
  getGoalAnalytics,
} from "@ai-cofounder/db";
import { getJobStatus } from "@ai-cofounder/queue";
import {
  CreateGoalBody,
  UpdateGoalStatusBody,
  BulkGoalStatusBody,
  IdParams,
  GoalListQuery,
} from "../schemas.js";
import { recordActionSafe } from "../services/action-recorder.js";

const logger = createLogger("goal-routes");

export const goalRoutes: FastifyPluginAsync = async (app) => {
  /* GET /analytics — goal performance metrics */
  app.get(
    "/analytics",
    {
      schema: {
        tags: ["goals"],
        summary: "Get aggregate goal performance metrics",
        description:
          "Returns goal-execution analytics for the current workspace: total/completed/failed goal counts, " +
          "average task counts, success rate, and breakdown by priority. Used by the dashboard home screen.",
      },
    },
    async (request) => getGoalAnalytics(app.db, request.workspaceId),
  );

  /* POST / — create a goal */
  app.post<{ Body: typeof CreateGoalBody.static }>(
    "/",
    {
      schema: {
        tags: ["goals"],
        summary: "Create a new goal",
        description:
          "Create a goal manually (rather than via the orchestrator's `create_plan` tool). Returns the " +
          "created goal. Broadcasts a `goals` WebSocket event and records a `goal_created` action. Tasks " +
          "must be added separately via the tasks endpoint.",
        body: CreateGoalBody,
      },
    },
    async (request, reply) => {
      const goal = await createGoal(app.db, { ...request.body, workspaceId: request.workspaceId });
      app.wsBroadcast?.("goals");
      recordActionSafe(app.db, {
        workspaceId: request.workspaceId,
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
    {
      schema: {
        tags: ["goals"],
        summary: "Get a goal by ID",
        description:
          "Returns 404 if the goal doesn't exist or isn't visible to the current workspace.",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id, request.workspaceId);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      return goal;
    },
  );

  /* GET / — list goals for a conversation (paginated) */
  app.get<{ Querystring: typeof GoalListQuery.static }>(
    "/",
    {
      schema: {
        tags: ["goals"],
        summary: "List goals for a conversation (paginated)",
        description:
          "Returns `{ data, total, limit, offset }`. Default limit is 50, max is 200. Useful for building " +
          "conversation-scoped goal dashboards.",
        querystring: GoalListQuery,
      },
    },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const [data, total] = await Promise.all([
        listGoalsByConversation(app.db, request.query.conversationId, {
          limit,
          offset,
          workspaceId: request.workspaceId,
        }),
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
    {
      schema: {
        tags: ["goals"],
        summary: "Update a goal's status",
        description:
          "Valid status transitions: proposed → active → completed/failed/cancelled. Use the dedicated " +
          "/:id/approve or /:id/reject endpoints for proposed goals, and /:id/cancel to stop an active goal.",
        params: IdParams,
        body: UpdateGoalStatusBody,
      },
    },
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
    {
      schema: {
        tags: ["goals"],
        summary: "Update status for many goals at once",
        description:
          "Atomically updates the status of up to 100 goals in one request. Returns `{ updated: number }` — the " +
          "count of goals that were actually updated (missing IDs are silently skipped). Broadcasts one `goals` " +
          "WebSocket event if any updates succeeded.",
        body: BulkGoalStatusBody,
      },
    },
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
    {
      schema: {
        tags: ["goals"],
        summary: "Get BullMQ queue status for a goal's execution job",
        description:
          "Returns the current state of the background execution job associated with this goal (from " +
          "`goal.metadata.queueJobId`). Returns `{ status: 'not_queued' }` if the goal was never enqueued, " +
          "`{ status: 'not_found' }` if the job ID is stale, or the full BullMQ job state otherwise.",
        params: IdParams,
      },
    },
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
    {
      schema: {
        tags: ["goals"],
        summary: "Clone a goal and all its tasks",
        description:
          "Creates a new goal named `<title> (copy)` with the same description/priority/milestone, then " +
          "duplicates all tasks with reset statuses (pending) via a batch insert. Useful for re-running " +
          "a completed goal or branching from a template.",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const original = await getGoal(app.db, request.params.id);
      if (!original) return reply.status(404).send({ error: "Goal not found" });

      const cloned = await createGoal(app.db, {
        workspaceId: request.workspaceId,
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
            workspaceId: request.workspaceId,
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
    {
      schema: {
        tags: ["goals"],
        summary: "Approve a proposed goal",
        description:
          "Transitions a goal from `proposed` → `active`, allowing the dispatcher to execute its tasks. " +
          "Goals are created as `proposed` when their scope is `external` or `destructive` (see " +
          "scope-classifier). Returns 409 if the goal isn't in `proposed` status.",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      if (goal.status !== "proposed") {
        return reply
          .status(409)
          .send({ error: `Cannot approve goal with status "${goal.status}" — must be "proposed"` });
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
    {
      schema: {
        tags: ["goals"],
        summary: "Reject a proposed goal",
        description:
          "Transitions a goal from `proposed` → `cancelled`. Optionally accepts a `reason` in the body " +
          "that is logged for audit purposes but not persisted on the goal record. Returns 409 if the " +
          "goal isn't in `proposed` status.",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const goal = await getGoal(app.db, request.params.id);
      if (!goal) return reply.status(404).send({ error: "Goal not found" });
      if (goal.status !== "proposed") {
        return reply
          .status(409)
          .send({ error: `Cannot reject goal with status "${goal.status}" — must be "proposed"` });
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
    {
      schema: {
        tags: ["goals"],
        summary: "Permanently delete a goal",
        description:
          "Hard-deletes the goal. Tasks are removed via `ON DELETE CASCADE`. Consider PATCH /:id/cancel " +
          "instead if you want to preserve the audit trail.",
        params: IdParams,
      },
    },
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
    {
      schema: {
        tags: ["goals"],
        summary: "Cancel an active goal",
        description:
          "Marks the goal as `cancelled` and stops any pending/running tasks from executing. Unlike DELETE, " +
          "the record is preserved so you can still view the goal's history and any completed tasks.",
        params: IdParams,
      },
    },
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
    {
      schema: {
        tags: ["goals"],
        summary: "Get post-completion verification results",
        description:
          "Returns the verification results stored in `goal.metadata.verification` after the dispatcher ran " +
          "`verifyGoalCompletion` on a completed goal. Returns 404 if the goal has no verification results yet " +
          "(still running, no verification service configured, or verification is in-flight).",
        params: IdParams,
      },
    },
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
