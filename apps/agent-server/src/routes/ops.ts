import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { createOpsAlert, listOpsAlerts, updateOpsAlert } from "@ai-cofounder/db";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { Orchestrator } from "../agents/orchestrator.js";

const logger = createLogger("ops");

/** Verify OPS_TOKEN query param — required in production, optional in dev */
function verifyToken(token: string | undefined): boolean {
  const opsToken = optionalEnv("OPS_TOKEN", "");
  if (!opsToken) {
    // In production, deny access when OPS_TOKEN is not configured
    if (process.env.NODE_ENV === "production") return false;
    return true; // Dev mode only
  }
  if (!token) return false;
  // Timing-safe comparison to prevent timing attacks
  if (token.length !== opsToken.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(opsToken));
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

  /** POST /api/ops/diagnose — Run LLM-powered investigation on unprocessed alerts */
  app.post<{
    Querystring: { token?: string };
    Body: { alertIds?: string[] };
  }>(
    "/diagnose",
    { schema: { tags: ["ops"] } },
    async (request, reply) => {
      // Gather context: unprocessed alerts + self-healing status
      const alerts = await listOpsAlerts(app.db, { status: "unprocessed", limit: 20 });
      const targetAlerts = request.body.alertIds?.length
        ? alerts.filter((a) => request.body.alertIds!.includes(a.id))
        : alerts;

      if (targetAlerts.length === 0) {
        return reply.send({ status: "no_alerts", message: "No unprocessed alerts to diagnose", actions: [] });
      }

      // Mark alerts as processing
      for (const alert of targetAlerts) {
        await updateOpsAlert(app.db, alert.id, { status: "processing" });
      }

      // Build self-healing context
      let healingContext = "Self-healing data not available.";
      try {
        const healingStatus = app.selfHealingService?.getStatus?.();
        if (healingStatus) {
          healingContext = JSON.stringify({
            healthScores: healingStatus.healthScores,
            circuitBreakers: healingStatus.circuitBreakers,
            recentFailures: healingStatus.recentFailurePatterns?.slice(0, 5),
            recommendations: healingStatus.recommendations,
          }, null, 2);
        }
      } catch { /* non-fatal */ }

      // Build diagnostic prompt
      const alertSummary = targetAlerts.map((a) =>
        `- [${a.severity}] ${a.title} (source: ${a.source}, id: ${a.id})\n  Body: ${JSON.stringify(a.body)}`,
      ).join("\n");

      const prompt = `You are the ops diagnostic agent for aviontechs.com infrastructure.

## Unprocessed Alerts
${alertSummary}

## Self-Healing Status
${healingContext}

## Your Task
1. Investigate each alert using available tools:
   - Use VPS tools to check Docker container status and logs
   - Check disk space and memory usage
   - Review recent git history if relevant
2. For each alert, determine:
   - Root cause (what went wrong)
   - Whether you can fix it (container restart, config change, etc.)
   - If you can fix it, do so now
   - If not, explain what manual intervention is needed
3. After investigating, provide a structured summary of findings and actions taken.

## Rules
- NEVER force-push, delete data, or drop tables
- Container restarts are safe — do them if needed
- If unsure about a fix, recommend manual review instead of guessing
- Be concise and actionable`;

      // Run orchestrator
      let result;
      try {
        const orchestrator = new Orchestrator({
          registry: app.llmRegistry,
          db: app.db,
          taskCategory: "simple",
          vpsCommandService: (app as any).vpsCommandService,
          workspaceService: app.workspaceService,
          sandboxService: app.sandboxService,
          isAutonomous: true,
        });

        result = await orchestrator.run(prompt, `ops-diagnose-${Date.now()}`, [], undefined);
      } catch (err) {
        logger.error({ err }, "orchestrator diagnosis failed");
        // Mark alerts back to unprocessed on failure
        for (const alert of targetAlerts) {
          await updateOpsAlert(app.db, alert.id, { status: "unprocessed" });
        }
        return reply.status(500).send({ status: "error", message: "Diagnosis failed", error: String(err) });
      }

      // Mark alerts resolved with the orchestrator's findings
      const resolution = result.response.slice(0, 2000); // Cap resolution length
      for (const alert of targetAlerts) {
        await updateOpsAlert(app.db, alert.id, { status: "resolved", resolution });
      }

      logger.info({ alertCount: targetAlerts.length, model: result.model }, "ops diagnosis completed");
      return reply.send({
        status: "diagnosed",
        alertsProcessed: targetAlerts.length,
        model: result.model,
        response: result.response,
        actions: result.plan?.tasks?.map((t) => t.title) ?? [],
      });
    },
  );
};
