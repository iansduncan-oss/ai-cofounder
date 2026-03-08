import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { getGoal, updateGoalMetadata } from "@ai-cofounder/db";
import { enqueueAgentTask, goalChannel } from "@ai-cofounder/queue";
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

  // dispatcher is still needed for GET /:id/progress
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
  // Subscribes to Redis pub/sub events published by the worker process.
  // Replays missed events from Redis history for late-joining clients.
  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/:id/execute/stream",
    { schema: { tags: ["execution"] } },
    async (request, reply) => {
      const goalId = request.params.id;

      // Set SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Helper: write a data-only SSE frame (no `event:` field — required for useSSE compatibility)
      const send = (data: unknown): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Cleanup: remove listener + unsubscribe + end response
      let cleanedUp = false;
      const channel = goalChannel(goalId);

      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        app.agentEvents.off(channel, onMessage);
        app.unsubscribeGoal(goalId).catch((err) => {
          logger.warn({ goalId, err }, "non-fatal: unsubscribeGoal failed during cleanup");
        });
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      };

      // Handler for live events arriving via EventEmitter
      const onMessage = (rawMessage: string): void => {
        try {
          const event = JSON.parse(rawMessage) as Record<string, unknown>;
          if (event.type === "job_completed") {
            send({ ...event, status: "completed" });
            cleanup();
          } else if (event.type === "job_failed") {
            send({ ...event, status: "failed" });
            cleanup();
          } else {
            // Progress event — forward as-is
            send(event);
          }
        } catch (err) {
          logger.warn({ goalId, err }, "failed to parse pub/sub message");
        }
      };

      // Step 1: Replay history for late-joining clients
      const history = await app.redisPubSub.getHistory(goalId);
      for (const event of history) {
        const lifecycleEvent = event as unknown as Record<string, unknown>;
        if (lifecycleEvent.type === "job_completed") {
          send({ ...lifecycleEvent, status: "completed" });
          reply.raw.end();
          return; // Job already finished — no need to subscribe to live events
        } else if (lifecycleEvent.type === "job_failed") {
          send({ ...lifecycleEvent, status: "failed" });
          reply.raw.end();
          return; // Job already failed — no need to subscribe to live events
        } else {
          // Progress event — send as-is
          send(event);
        }
      }

      // Step 2: Subscribe to live events (reference-counted per goal)
      await app.subscribeGoal(goalId);
      app.agentEvents.on(channel, onMessage);

      // Step 3: Clean up on client disconnect (critical for preventing listener leaks)
      reply.raw.on("close", cleanup);

      logger.info({ goalId, historyCount: history.length }, "SSE client connected");
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
