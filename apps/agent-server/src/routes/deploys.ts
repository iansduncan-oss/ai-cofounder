import type { FastifyInstance } from "fastify";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import {
  createDeployment,
  updateDeploymentStatus,
  getLatestDeployment,
  listDeployments,
  getDeploymentBySha,
} from "@ai-cofounder/db";
import { recordActionSafe } from "../services/action-recorder.js";

const logger = createLogger("deploy-routes");

/**
 * Public deploy webhook route — registered outside JWT guard.
 * Accepts deploy events from GitHub Actions.
 */
export async function deployWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post("/api/deploys/webhook", {
    schema: {
      tags: ["deploys"],
      body: {
        type: "object",
        properties: {
          event: { type: "string", enum: ["deploy_started", "deploy_completed", "deploy_failed"] },
          commitSha: { type: "string" },
          shortSha: { type: "string" },
          branch: { type: "string" },
          previousSha: { type: "string" },
          services: { type: "array", items: { type: "string" } },
          triggeredBy: { type: "string" },
          error: { type: "string" },
        },
        required: ["event", "commitSha"],
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      event: string;
      commitSha: string;
      shortSha?: string;
      branch?: string;
      previousSha?: string;
      services?: string[];
      triggeredBy?: string;
      error?: string;
    };

    // Validate webhook secret if configured
    const webhookSecret = optionalEnv("DEPLOY_WEBHOOK_SECRET", "");
    if (webhookSecret) {
      const authHeader = request.headers.authorization;
      if (authHeader !== `Bearer ${webhookSecret}`) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    }

    const db = app.db;
    const shortSha = body.shortSha ?? body.commitSha.slice(0, 7);

    switch (body.event) {
      case "deploy_started": {
        const deployment = await createDeployment(db, {
          commitSha: body.commitSha,
          shortSha,
          branch: body.branch ?? "main",
          services: body.services,
          previousSha: body.previousSha,
          triggeredBy: body.triggeredBy ?? "ci",
        });

        logger.info({ deploymentId: deployment.id, sha: shortSha }, "deploy started");
        recordActionSafe(db, {
          actionType: "deploy_triggered",
          actionDetail: `${body.branch ?? "main"}@${shortSha}`,
          metadata: { deploymentId: deployment.id, triggeredBy: body.triggeredBy },
        });

        // Enqueue delayed verification job if queue available
        try {
          const { getDeployVerificationQueue } = await import("@ai-cofounder/queue");
          await getDeployVerificationQueue().add(
            "verify-deploy",
            {
              deploymentId: deployment.id,
              commitSha: body.commitSha,
              previousSha: body.previousSha,
            },
            { delay: 15_000 }, // wait 15s for services to boot
          );
        } catch {
          logger.debug("deploy verification queue not available");
        }

        return reply.code(201).send({ id: deployment.id, status: "started" });
      }

      case "deploy_completed": {
        const existing = await getDeploymentBySha(db, body.commitSha);
        if (!existing) {
          return reply.code(404).send({ error: "Deployment not found" });
        }
        await updateDeploymentStatus(db, existing.id, { status: "verifying" });
        logger.info({ deploymentId: existing.id }, "deploy completed, verifying");
        return { id: existing.id, status: "verifying" };
      }

      case "deploy_failed": {
        const existing = await getDeploymentBySha(db, body.commitSha);
        if (!existing) {
          return reply.code(404).send({ error: "Deployment not found" });
        }
        await updateDeploymentStatus(db, existing.id, {
          status: "failed",
          errorLog: body.error,
          completedAt: new Date(),
        });
        logger.warn({ deploymentId: existing.id, error: body.error }, "deploy failed");

        // Enqueue root cause analysis job
        try {
          const { getDeployVerificationQueue } = await import("@ai-cofounder/queue");
          await getDeployVerificationQueue().add("analyze-failure", {
            deploymentId: existing.id,
            commitSha: body.commitSha,
            previousSha: existing.previousSha,
            errorLog: body.error,
          });
        } catch {
          logger.debug("deploy verification queue not available");
        }

        return { id: existing.id, status: "failed" };
      }

      default:
        return reply.code(400).send({ error: `Unknown event: ${body.event}` });
    }
  });
}

/**
 * Protected deploy list routes — registered inside JWT guard.
 */
export async function deployRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deploys — list recent deployments
  app.get("/", { schema: { tags: ["deploys"] } }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const deploys = await listDeployments(app.db, limit);
    return { data: deploys, total: deploys.length };
  });

  // GET /api/deploys/latest — get latest deployment
  app.get("/latest", { schema: { tags: ["deploys"] } }, async () => {
    const latest = await getLatestDeployment(app.db);
    if (!latest) {
      return { data: null };
    }
    return { data: latest };
  });
}
