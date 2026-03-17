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
          event: { type: "string", enum: ["deploy_started", "deploy_completed", "deploy_failed", "deploy_rolled_back"] },
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
        // Check circuit breaker before allowing deploy
        if (app.deployCircuitBreakerService) {
          const paused = await app.deployCircuitBreakerService.isDeployPaused();
          if (paused) {
            const status = await app.deployCircuitBreakerService.getStatus();
            logger.warn({ sha: shortSha, reason: status.pausedReason }, "deploy blocked by circuit breaker");
            return reply.code(503).send({
              error: "Deploy paused by circuit breaker",
              reason: status.pausedReason,
              failureCount: status.failureCount,
            });
          }
        }

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

        // Record failure in circuit breaker
        if (app.deployCircuitBreakerService) {
          await app.deployCircuitBreakerService.recordFailure(body.commitSha, body.error).catch((err: unknown) => {
            logger.warn({ err }, "circuit breaker failure recording failed");
          });
        }

        // Enqueue root cause analysis job
        try {
          const { getDeployVerificationQueue } = await import("@ai-cofounder/queue");
          await getDeployVerificationQueue().add("analyze-failure", {
            deploymentId: existing.id,
            commitSha: body.commitSha,
            previousSha: existing.previousSha ?? undefined,
            errorLog: body.error,
          });
        } catch {
          logger.debug("deploy verification queue not available");
        }

        return { id: existing.id, status: "failed" };
      }

      case "deploy_rolled_back": {
        const existing = await getDeploymentBySha(db, body.commitSha);
        if (!existing) {
          return reply.code(404).send({ error: "Deployment not found" });
        }
        await updateDeploymentStatus(db, existing.id, {
          status: "rolled_back" as Parameters<typeof updateDeploymentStatus>[2]["status"],
          errorLog: body.error ?? "Auto-rollback after health check failure",
          completedAt: new Date(),
        });
        logger.warn({ deploymentId: existing.id, previousSha: body.previousSha }, "deploy rolled back");
        return { id: existing.id, status: "rolled_back" };
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
  // GET /api/deploys — list recent deployments (paginated)
  app.get("/", { schema: { tags: ["deploys"] } }, async (request) => {
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    return listDeployments(app.db, { limit, offset });
  });

  // GET /api/deploys/latest — get latest deployment
  app.get("/latest", { schema: { tags: ["deploys"] } }, async () => {
    const latest = await getLatestDeployment(app.db);
    if (!latest) {
      return { data: null };
    }
    return { data: latest };
  });

  // GET /api/deploys/circuit-breaker — get circuit breaker status
  app.get("/circuit-breaker", { schema: { tags: ["deploys"] } }, async (_request, reply) => {
    if (!app.deployCircuitBreakerService) {
      return reply.code(503).send({ error: "Circuit breaker service not available" });
    }
    const status = await app.deployCircuitBreakerService.getStatus();
    return { data: status };
  });

  // POST /api/deploys/circuit-breaker/resume — resume auto-deploys
  app.post("/circuit-breaker/resume", { schema: { tags: ["deploys"] } }, async (request, reply) => {
    if (!app.deployCircuitBreakerService) {
      return reply.code(503).send({ error: "Circuit breaker service not available" });
    }
    const body = request.body as { resumedBy?: string } | undefined;
    await app.deployCircuitBreakerService.resume(body?.resumedBy ?? "dashboard");
    app.agentEvents?.emit("ws:deploys");
    return { status: "resumed" };
  });
}
