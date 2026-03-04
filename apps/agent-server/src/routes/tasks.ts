import type { FastifyPluginAsync } from "fastify";
import type { AgentRole } from "@ai-cofounder/shared";
import {
  createTask,
  getTask,
  listTasksByGoal,
  listPendingTasks,
  assignTask,
  startTask,
  completeTask,
  failTask,
} from "@ai-cofounder/db";
import {
  CreateTaskBody,
  GoalIdQuery,
  IdParams,
  AssignTaskBody,
  CompleteTaskBody,
  FailTaskBody,
  ListPendingQuery,
} from "../schemas.js";

export const taskRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create a task */
  app.post<{ Body: typeof CreateTaskBody.static }>(
    "/",
    { schema: { body: CreateTaskBody } },
    async (request, reply) => {
      const task = await createTask(app.db, request.body);
      return reply.status(201).send(task);
    },
  );

  /* GET /pending — list pending tasks */
  app.get<{ Querystring: typeof ListPendingQuery.static }>(
    "/pending",
    { schema: { querystring: ListPendingQuery } },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingTasks(app.db, limit);
    },
  );

  /* GET /:id — get a single task */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { params: IdParams } },
    async (request, reply) => {
      const task = await getTask(app.db, request.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* GET / — list tasks for a goal */
  app.get<{ Querystring: typeof GoalIdQuery.static }>(
    "/",
    { schema: { querystring: GoalIdQuery } },
    async (request) => {
      return listTasksByGoal(app.db, request.query.goalId);
    },
  );

  /* PATCH /:id/assign — assign task to an agent */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof AssignTaskBody.static;
  }>(
    "/:id/assign",
    { schema: { params: IdParams, body: AssignTaskBody } },
    async (request, reply) => {
      const task = await assignTask(
        app.db,
        request.params.id,
        request.body.agent,
      );
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* PATCH /:id/start — mark task as running */
  app.patch<{ Params: typeof IdParams.static }>(
    "/:id/start",
    { schema: { params: IdParams } },
    async (request, reply) => {
      const task = await startTask(app.db, request.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* PATCH /:id/complete — mark task as completed */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof CompleteTaskBody.static;
  }>(
    "/:id/complete",
    { schema: { params: IdParams, body: CompleteTaskBody } },
    async (request, reply) => {
      const task = await completeTask(
        app.db,
        request.params.id,
        request.body.result,
      );
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* PATCH /:id/fail — mark task as failed */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof FailTaskBody.static;
  }>(
    "/:id/fail",
    { schema: { params: IdParams, body: FailTaskBody } },
    async (request, reply) => {
      const task = await failTask(
        app.db,
        request.params.id,
        request.body.error,
      );
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );
};
