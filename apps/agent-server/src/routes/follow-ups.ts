import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import {
  createFollowUp,
  getFollowUp,
  listFollowUps,
  updateFollowUp,
  deleteFollowUp,
} from "@ai-cofounder/db";

const CreateFollowUpBody = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  dueDate: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
});
type CreateFollowUpBody = Static<typeof CreateFollowUpBody>;

const UpdateFollowUpBody = Type.Object({
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  status: Type.Optional(
    Type.Union([Type.Literal("pending"), Type.Literal("done"), Type.Literal("dismissed")]),
  ),
  dueDate: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  source: Type.Optional(Type.String()),
});
type UpdateFollowUpBody = Static<typeof UpdateFollowUpBody>;

export async function followUpRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/follow-ups — create
  app.post<{ Body: CreateFollowUpBody }>(
    "/",
    {
      schema: {
        tags: ["follow-ups"],
        summary: "Create a follow-up item",
        description:
          "Creates a lightweight follow-up (to-do) for the user. Similar to tasks but not tied to a goal — " +
          "useful for 'remind me to check in on this PR later' style items. The orchestrator can create " +
          "these from chat via the `create_follow_up` tool.",
        body: CreateFollowUpBody,
      },
    },
    async (request) => {
      const { title, description, dueDate, source } = request.body;
      const row = await createFollowUp(app.db, {
        workspaceId: request.workspaceId,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        source,
      });
      app.wsBroadcast?.("follow-ups");
      return row;
    },
  );

  // GET /api/follow-ups — list with optional status filter
  app.get(
    "/",
    {
      schema: {
        tags: ["follow-ups"],
        summary: "List follow-ups with optional status filter",
        description:
          "Returns follow-ups for the current workspace. Filter by `?status=pending|done|dismissed` and " +
          "paginate with `limit` + `offset`.",
      },
    },
    async (request) => {
      const { status, limit, offset } = request.query as {
        status?: "pending" | "done" | "dismissed";
        limit?: string;
        offset?: string;
      };
      return listFollowUps(app.db, {
        status,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        workspaceId: request.workspaceId,
      });
    },
  );

  // GET /api/follow-ups/:id — single
  app.get(
    "/:id",
    {
      schema: {
        tags: ["follow-ups"],
        summary: "Get a follow-up by ID",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await getFollowUp(app.db, id);
      if (!row) return reply.status(404).send({ error: "Follow-up not found" });
      return row;
    },
  );

  // PATCH /api/follow-ups/:id — update
  app.patch<{ Body: UpdateFollowUpBody }>(
    "/:id",
    {
      schema: {
        tags: ["follow-ups"],
        summary: "Update a follow-up (title, status, due date, etc.)",
        description:
          "Marking a follow-up as `done` triggers a debounced plan sync via `app.planSync.schedule()` so " +
          "the productivity tracker can update the daily plan.",
        body: UpdateFollowUpBody,
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { title, description, status, dueDate, source } = request.body;
      const row = await updateFollowUp(app.db, id, {
        title,
        description,
        status,
        dueDate: dueDate === null ? null : dueDate ? new Date(dueDate) : undefined,
        source,
      });
      if (!row) return reply.status(404).send({ error: "Follow-up not found" });
      app.wsBroadcast?.("follow-ups");
      if (status === "done") {
        app.planSync?.schedule();
      }
      return row;
    },
  );

  // DELETE /api/follow-ups/:id — delete
  app.delete(
    "/:id",
    {
      schema: {
        tags: ["follow-ups"],
        summary: "Delete a follow-up",
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await deleteFollowUp(app.db, id);
      if (!row) return reply.status(404).send({ error: "Follow-up not found" });
      app.wsBroadcast?.("follow-ups");
      return { deleted: true, id };
    },
  );
}
