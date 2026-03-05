import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { TaskDispatcher, type TaskProgressCallback } from "../agents/dispatcher.js";

const logger = createLogger("execution-routes");

export const executionRoutes: FastifyPluginAsync = async (app) => {
  const dispatcher = new TaskDispatcher(app.llmRegistry, app.db, app.embeddingService);

  // Execute all tasks for a goal
  app.post<{ Params: { id: string }; Body: { userId?: string; webhookUrl?: string } }>(
    "/:id/execute",
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

  // Get execution progress for a goal
  app.get<{ Params: { id: string } }>("/:id/progress", async (request, reply) => {
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
