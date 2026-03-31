import type { FastifyPluginAsync } from "fastify";
import {
  createWorkspace,
  listWorkspacesByOwner,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from "@ai-cofounder/db";

export const workspaceTenantRoutes: FastifyPluginAsync = async (app) => {
  // List workspaces for the authenticated user
  app.get("/", async (request) => {
    const user = request.user as { sub?: string } | undefined;
    if (!user?.sub) return { workspaces: [] };
    const rows = await listWorkspacesByOwner(app.db, user.sub);
    return { workspaces: rows };
  });

  // Create a new workspace
  app.post<{ Body: { name: string; slug: string } }>("/", async (request, reply) => {
    const user = request.user as { sub?: string; role?: string } | undefined;
    if (!user?.sub) return reply.code(401).send({ error: "Unauthorized" });

    const { name, slug } = request.body;
    if (!name || !slug) return reply.code(400).send({ error: "name and slug are required" });

    const slugRe = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
    if (!slugRe.test(slug)) {
      return reply.code(400).send({ error: "slug must be lowercase alphanumeric with optional hyphens" });
    }

    try {
      const ws = await createWorkspace(app.db, { name, slug, ownerId: user.sub });
      return reply.code(201).send(ws);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "A workspace with this slug already exists" });
      }
      throw err;
    }
  });

  // Get workspace details
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const ws = await getWorkspace(app.db, request.params.id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    return ws;
  });

  // Update workspace
  app.patch<{ Params: { id: string }; Body: { name?: string; slug?: string } }>(
    "/:id",
    async (request, reply) => {
      const ws = await getWorkspace(app.db, request.params.id);
      if (!ws) return reply.code(404).send({ error: "Workspace not found" });

      const updated = await updateWorkspace(app.db, ws.id, request.body);
      return updated;
    },
  );

  // Delete workspace (cannot delete default)
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const ws = await getWorkspace(app.db, request.params.id);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    if (ws.isDefault) return reply.code(400).send({ error: "Cannot delete the default workspace" });

    await deleteWorkspace(app.db, ws.id);
    return { deleted: true };
  });
};
