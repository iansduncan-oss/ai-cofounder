import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { TaskDispatcher, type TaskProgressCallback } from "../agents/dispatcher.js";
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

  // Execute all tasks for a goal
  app.post<{ Params: { id: string }; Body: { userId?: string; webhookUrl?: string } }>(
    "/:id/execute",
    { schema: { tags: ["execution"] } },
    async (request, reply) => {
      const { id } = request.params;
      const { userId, webhookUrl } = request.body ?? {};

      let onProgress: TaskProgressCallback | undefined;
      if (webhookUrl) {
        onProgress = async (event) => {
          try {
            const statusIcon =
              event.status === "completed"
                ? "\u2705"
                : event.status === "failed"
                  ? "\u274c"
                  : "\ud83d\udd35";
            await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                embeds: [
                  {
                    title: `${statusIcon} Task ${event.status}: ${event.taskTitle}`,
                    description: event.output ? event.output.slice(0, 2048) : undefined,
                    color:
                      event.status === "completed"
                        ? 2278400
                        : event.status === "failed"
                          ? 15548997
                          : 8158332,
                    footer: {
                      text: `${event.completedTasks}/${event.totalTasks} tasks · Agent: ${event.agent} · Goal: ${event.goalTitle}`,
                    },
                  },
                ],
              }),
            });
          } catch (err) {
            logger.warn({ err }, "failed to send progress webhook");
          }
        };
      }

      try {
        const progress = await dispatcher.runGoal(id, userId, onProgress);
        return progress;
      } catch (err) {
        if (err instanceof Error && err.message.includes("not found")) {
          return reply.status(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // Stream execution progress via SSE
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

      const onProgress: TaskProgressCallback = async (event) => {
        send("progress", event);
      };

      try {
        send("started", { goalId: id });
        const result = await dispatcher.runGoal(id, userId, onProgress);
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
