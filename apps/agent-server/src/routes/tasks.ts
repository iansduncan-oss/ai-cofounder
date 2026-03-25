import type { FastifyPluginAsync } from "fastify";
import {
  createTask,
  getTask,
  listTasksByGoal,
  countTasksByGoal,
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
  TaskListQuery,
} from "../schemas.js";

export const taskRoutes: FastifyPluginAsync = async (app) => {
  /* POST / — create a task */
  app.post<{ Body: typeof CreateTaskBody.static }>(
    "/",
    { schema: { tags: ["tasks"], body: CreateTaskBody } },
    async (request, reply) => {
      const task = await createTask(app.db, request.body);
      app.wsBroadcast?.("tasks");
      return reply.status(201).send(task);
    },
  );

  /* GET /pending — list pending tasks */
  app.get<{ Querystring: typeof ListPendingQuery.static }>(
    "/pending",
    { schema: { tags: ["tasks"], querystring: ListPendingQuery } },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingTasks(app.db, limit);
    },
  );

  /* GET /:id — get a single task */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["tasks"], params: IdParams } },
    async (request, reply) => {
      const task = await getTask(app.db, request.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* GET / — list tasks for a goal (paginated) */
  app.get<{ Querystring: typeof TaskListQuery.static }>(
    "/",
    { schema: { tags: ["tasks"], querystring: TaskListQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const [data, total] = await Promise.all([
        listTasksByGoal(app.db, request.query.goalId, { limit, offset }),
        countTasksByGoal(app.db, request.query.goalId),
      ]);
      return { data, total, limit, offset };
    },
  );

  /* PATCH /:id/assign — assign task to an agent */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof AssignTaskBody.static;
  }>(
    "/:id/assign",
    { schema: { tags: ["tasks"], params: IdParams, body: AssignTaskBody } },
    async (request, reply) => {
      const task = await assignTask(app.db, request.params.id, request.body.agent);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      app.wsBroadcast?.("tasks");
      return task;
    },
  );

  /* PATCH /:id/start — mark task as running */
  app.patch<{ Params: typeof IdParams.static }>(
    "/:id/start",
    { schema: { tags: ["tasks"], params: IdParams } },
    async (request, reply) => {
      const task = await startTask(app.db, request.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      app.wsBroadcast?.("tasks");
      return task;
    },
  );

  /* PATCH /:id/complete — mark task as completed */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof CompleteTaskBody.static;
  }>(
    "/:id/complete",
    { schema: { tags: ["tasks"], params: IdParams, body: CompleteTaskBody } },
    async (request, reply) => {
      const task = await completeTask(app.db, request.params.id, request.body.result);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      app.wsBroadcast?.("tasks");
      return task;
    },
  );

  /* PATCH /:id/fail — mark task as failed */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof FailTaskBody.static;
  }>("/:id/fail", { schema: { tags: ["tasks"], params: IdParams, body: FailTaskBody } }, async (request, reply) => {
    const task = await failTask(app.db, request.params.id, request.body.error);
    if (!task) return reply.status(404).send({ error: "Task not found" });
    app.wsBroadcast?.("tasks");
    return task;
  });
};
