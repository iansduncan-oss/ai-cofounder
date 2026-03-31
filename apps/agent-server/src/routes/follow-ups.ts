import type { FastifyInstance } from "fastify";
import {
  createFollowUp,
  getFollowUp,
  listFollowUps,
  updateFollowUp,
  deleteFollowUp,
} from "@ai-cofounder/db";

export async function followUpRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/follow-ups — create
  app.post("/", async (request) => {
    const { title, description, dueDate, source } = request.body as {
      title: string;
      description?: string;
      dueDate?: string;
      source?: string;
    };
    const row = await createFollowUp(app.db, {
      workspaceId: request.workspaceId,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      source,
    });
    app.wsBroadcast?.("follow-ups");
    return row;
  });

  // GET /api/follow-ups — list with optional status filter
  app.get("/", async (request) => {
    const { status, limit, offset } = request.query as {
      status?: "pending" | "done" | "dismissed";
      limit?: string;
      offset?: string;
    };
    return listFollowUps(app.db, {
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  });

  // GET /api/follow-ups/:id — single
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await getFollowUp(app.db, id);
    if (!row) return reply.status(404).send({ error: "Follow-up not found" });
    return row;
  });

  // PATCH /api/follow-ups/:id — update
  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { title, description, status, dueDate, source } = request.body as {
      title?: string;
      description?: string;
      status?: "pending" | "done" | "dismissed";
      dueDate?: string | null;
      source?: string;
    };
    const row = await updateFollowUp(app.db, id, {
      title,
      description,
      status,
      dueDate: dueDate === null ? null : dueDate ? new Date(dueDate) : undefined,
      source,
    });
    if (!row) return reply.status(404).send({ error: "Follow-up not found" });
    app.wsBroadcast?.("follow-ups");
    return row;
  });

  // DELETE /api/follow-ups/:id — delete
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await deleteFollowUp(app.db, id);
    if (!row) return reply.status(404).send({ error: "Follow-up not found" });
    app.wsBroadcast?.("follow-ups");
    return { deleted: true, id };
  });
}
