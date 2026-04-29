import type { FastifyPluginAsync } from "fastify";
import { createOpsAlert, listOpsAlerts, updateOpsAlert } from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("ops");

/** Verify OPS_TOKEN query param (same pattern as recap routes) */
function verifyToken(token: string | undefined): boolean {
  const opsToken = optionalEnv("OPS_TOKEN", "");
  if (!opsToken) return true; // No token configured = allow all (dev mode)
  return token === opsToken;
}

export const opsRoutes: FastifyPluginAsync = async (app) => {
  // Token verification hook for all ops routes
  app.addHook("onRequest", async (request, reply) => {
    const token = (request.query as Record<string, string>).token;
    if (!verifyToken(token)) {
      reply.status(401).send({ error: "Invalid ops token" });
    }
  });

  /** POST /api/ops/alerts — Ingest an alert from n8n or manual submission */
  app.post<{
    Querystring: { token?: string };
    Body: {
      source: "alertmanager" | "deploy" | "health" | "manual";
      severity?: string;
      title: string;
      body?: unknown;
    };
  }>(
    "/alerts",
    { schema: { tags: ["ops"] } },
    async (request, reply) => {
      const { source, severity, title, body } = request.body;
      if (!source || !title) {
        return reply.status(400).send({ error: "source and title are required" });
      }
      const alert = await createOpsAlert(app.db, { source, severity, title, body });
      logger.info({ id: alert.id, source, title }, "ops alert created");
      return reply.status(201).send(alert);
    },
  );

  /** GET /api/ops/alerts — List alerts, optionally filtered by status */
  app.get<{
    Querystring: { token?: string; status?: string; limit?: string };
  }>(
    "/alerts",
    { schema: { tags: ["ops"] } },
    async (request) => {
      const { status, limit } = request.query;
      return listOpsAlerts(app.db, {
        status: status || undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    },
  );

  /** PATCH /api/ops/alerts/:id — Update alert status/resolution */
  app.patch<{
    Querystring: { token?: string };
    Params: { id: string };
    Body: {
      status?: "unprocessed" | "processing" | "resolved" | "ignored" | "needs-review";
      resolution?: string;
    };
  }>(
    "/alerts/:id",
    { schema: { tags: ["ops"] } },
    async (request, reply) => {
      const { id } = request.params;
      const { status, resolution } = request.body;
      const alert = await updateOpsAlert(app.db, id, { status, resolution });
      if (!alert) {
        return reply.status(404).send({ error: "Alert not found" });
      }
      logger.info({ id, status, resolution }, "ops alert updated");
      return alert;
    },
  );
};
