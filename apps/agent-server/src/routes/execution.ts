import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { getGoal, updateGoalMetadata } from "@ai-cofounder/db";
import { enqueueAgentTask } from "@ai-cofounder/queue";
import { TaskDispatcher } from "../agents/dispatcher.js";
import { VerificationService } from "../services/verification.js";

const logger = createLogger("execution-routes");

export const executionRoutes: FastifyPluginAsync = async (app) => {
  const verificationService = new VerificationService(
    app.llmRegistry,
    app.db,
    app.notificationService,
    app.workspaceService,
    app.sandboxService,
  );

  const dispatcher = new TaskDispatcher(
    app.llmRegistry,
    app.db,
    app.embeddingService,
    app.sandboxService,
    app.notificationService,
    app.workspaceService,
    verificationService,
  );

  // Execute all tasks for a goal — non-blocking: enqueues to BullMQ and returns 202
  app.post<{
    Params: { id: string };
    Body: { userId?: string; webhookUrl?: string; priority?: "critical" | "high" | "normal" | "low" };
  }>(
    "/:id/execute",
    { schema: { tags: ["execution"] } },
    async (request, reply) => {
      const { id } = request.params;
      const { userId, webhookUrl, priority } = request.body ?? {};

      // Look up the goal to validate it exists
      const goal = await getGoal(app.db, id);
      if (!goal) {
        return reply.status(404).send({ error: `Goal not found: ${id}` });
      }

      // Enqueue job to BullMQ — returns immediately with jobId
      const jobId = await enqueueAgentTask({
        goalId: id,
        prompt: goal.description ?? goal.title,
        userId,
        priority,
      });

      // Store jobId (and optional webhookUrl) in goal metadata for later status lookup
      await updateGoalMetadata(app.db, id, {
        queueJobId: jobId,
        ...(webhookUrl ? { webhookUrl } : {}),
      });

      logger.info({ goalId: id, jobId, userId }, "Goal execution enqueued");

      return reply.status(202).send({
        jobId,
        status: "queued",
        goalId: id,
      });
    },
  );

  // Stream execution progress via SSE
  // NOTE: This endpoint still uses in-process execution for now.
  // Phase 2 will bridge events from the worker via Redis pub/sub.
  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/:id/execute/stream",
    { schema: { tags: ["execution"] } },
    async (request, reply) => {
      const { id } = request.params;
      const { userId } = request.query;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        send("started", { goalId: id });
        const result = await dispatcher.runGoal(id, userId);
        send("completed", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { error: message });
      } finally {
        reply.raw.end();
      }
    },
  );

  // Get execution progress for a goal
  app.get<{ Params: { id: string } }>("/:id/progress", { schema: { tags: ["execution"] } }, async (request, reply) => {
    const { id } = request.params;

    try {
      const progress = await dispatcher.getProgress(id);
      return progress;
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.status(404).send({ error: err.message });
      }
      throw err;
    }
  });
};
