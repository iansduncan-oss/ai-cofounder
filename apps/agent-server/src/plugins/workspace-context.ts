import type { FastifyInstance } from "fastify";
import { getWorkspace, getDefaultWorkspace, getSystemDefaultWorkspace } from "@ai-cofounder/db";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("workspace-context");

declare module "fastify" {
  interface FastifyRequest {
    workspaceId: string;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Workspace context middleware. Resolves `request.workspaceId` from the
 * `X-Workspace-Id` header or falls back to the user's default workspace.
 *
 * Must be registered INSIDE jwtGuardPlugin (scoped) so request.user is available.
 */
export async function workspaceContextPlugin(app: FastifyInstance) {
  // Cache the system default workspace ID to avoid repeated DB lookups
  let cachedSystemDefault: string | null = null;

  app.decorateRequest("workspaceId", "");

  app.addHook("onRequest", async (request, reply) => {
    const headerValue = request.headers["x-workspace-id"];
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const user = request.user as { sub?: string } | undefined;

    // If header provided, validate and use it
    if (header && UUID_RE.test(header)) {
      const ws = await getWorkspace(app.db, header);
      if (!ws) {
        reply.code(404).send({ error: "Workspace not found" });
        return;
      }
      // For authenticated users, verify ownership
      if (user?.sub && ws.ownerId !== user.sub) {
        reply.code(403).send({ error: "Access denied to this workspace" });
        return;
      }
      request.workspaceId = ws.id;
      return;
    }

    // No header — resolve default workspace
    if (user?.sub) {
      const defaultWs = await getDefaultWorkspace(app.db, user.sub);
      if (defaultWs) {
        request.workspaceId = defaultWs.id;
        return;
      }
    }

    // Fallback: system default (for bots, internal, dev mode)
    if (!cachedSystemDefault) {
      const sysDefault = await getSystemDefaultWorkspace(app.db);
      cachedSystemDefault = sysDefault?.id ?? null;
    }
    if (cachedSystemDefault) {
      request.workspaceId = cachedSystemDefault;
      return;
    }

    // No workspace exists at all — likely first boot before migration
    logger.warn("no workspace found — workspace context unavailable");
  });
}
