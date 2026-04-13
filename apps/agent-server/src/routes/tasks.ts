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
    {
      schema: {
        tags: ["tasks"],
        summary: "Create a task for an existing goal",
        description:
          "Adds a task manually (rather than via the orchestrator's `create_plan` tool). Tasks belong to " +
          "a goal and are assigned to a specialist agent (researcher/coder/reviewer/planner/debugger/doc_writer).",
        body: CreateTaskBody,
      },
    },
    async (request, reply) => {
      const task = await createTask(app.db, { ...request.body, workspaceId: request.workspaceId });
      app.wsBroadcast?.("tasks");
      return reply.status(201).send(task);
    },
  );

  /* GET /pending — list pending tasks */
  app.get<{ Querystring: typeof ListPendingQuery.static }>(
    "/pending",
    {
      schema: {
        tags: ["tasks"],
        summary: "List pending tasks across all goals in the workspace",
        description:
          "Returns tasks with status `pending` — these are queued for dispatcher execution but haven't " +
          "started yet. Used by the dashboard's next-up card and the /next productivity endpoint.",
        querystring: ListPendingQuery,
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 50;
      return listPendingTasks(app.db, limit, request.workspaceId);
    },
  );

  /* GET /:id — get a single task */
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    {
      schema: {
        tags: ["tasks"],
        summary: "Get a task by ID",
        description:
          "Returns the task record including its goal reference, assigned agent, status, input/output, and " +
          "dependency list. 404 if not found.",
        params: IdParams,
      },
    },
    async (request, reply) => {
      const task = await getTask(app.db, request.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return task;
    },
  );

  /* GET / — list tasks for a goal (paginated) */
  app.get<{ Querystring: typeof TaskListQuery.static }>(
    "/",
    {
      schema: {
        tags: ["tasks"],
        summary: "List tasks for a goal (paginated)",
        description:
          "Returns `{ data, total, limit, offset }`. Tasks are ordered by `orderIndex`. Default limit is 50, " +
          "max is 200.",
        querystring: TaskListQuery,
      },
    },
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
    {
      schema: {
        tags: ["tasks"],
        summary: "Assign (or re-assign) a task to a specialist agent",
        description:
          "Updates the `assignedAgent` field. The dispatcher will route the task to the new agent on its " +
          "next execution. Normally the orchestrator assigns agents at plan creation — use this only to " +
          "manually override a routing decision.",
        params: IdParams,
        body: AssignTaskBody,
      },
    },
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
    {
      schema: {
        tags: ["tasks"],
        summary: "Mark a task as running",
        description:
          "Transitions status `pending` → `running` and sets `startedAt`. Normally the dispatcher calls this " +
          "automatically before invoking a specialist — prefer that path.",
        params: IdParams,
      },
    },
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
    {
      schema: {
        tags: ["tasks"],
        summary: "Mark a task as completed with its result",
        description:
          "Transitions status `running` → `completed`, stores the `result` string on the task, sets " +
          "`finishedAt`, and triggers a debounced productivity plan sync via `app.planSync.schedule()`.",
        params: IdParams,
        body: CompleteTaskBody,
      },
    },
    async (request, reply) => {
      const task = await completeTask(app.db, request.params.id, request.body.result);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      app.wsBroadcast?.("tasks");
      app.planSync?.schedule();
      return task;
    },
  );

  /* PATCH /:id/fail — mark task as failed */
  app.patch<{
    Params: typeof IdParams.static;
    Body: typeof FailTaskBody.static;
  }>(
    "/:id/fail",
    {
      schema: {
        tags: ["tasks"],
        summary: "Mark a task as failed with an error message",
        description:
          "Transitions status to `failed` and stores the `error` string on the task. The dispatcher calls " +
          "this automatically when a specialist throws after exhausting retries; the DAG executor cascades " +
          "the failure to block downstream dependents.",
        params: IdParams,
        body: FailTaskBody,
      },
    },
    async (request, reply) => {
      const task = await failTask(app.db, request.params.id, request.body.error);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      app.wsBroadcast?.("tasks");
      return task;
    },
  );
};
