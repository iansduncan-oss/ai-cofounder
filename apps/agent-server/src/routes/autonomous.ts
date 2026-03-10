import type { FastifyPluginAsync } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { getGoal, listGoalBacklog, listRecentWorkSessions, updateGoalMetadata } from "@ai-cofounder/db";
import { enqueueAgentTask } from "@ai-cofounder/queue";

const logger = createLogger("autonomous-routes");

export const autonomousRoutes: FastifyPluginAsync = async (app) => {
  // GET / — List goals ready for autonomous execution (backlog)
  app.get<{ Querystring: { limit?: string } }>(
    "/",
    { schema: { tags: ["autonomous"] } },
    async (request, reply) => {
      const rawLimit = parseInt(request.query.limit ?? "5", 10);
      const limit = Math.min(isNaN(rawLimit) ? 5 : Math.max(1, rawLimit), 20);

      const data = await listGoalBacklog(app.db, limit);
      return reply.send({ data, count: data.length });
    },
  );

  // GET /sessions — List recent work sessions
  app.get<{ Querystring: { limit?: string } }>(
    "/sessions",
    { schema: { tags: ["autonomous"] } },
    async (request, reply) => {
      const rawLimit = parseInt(request.query.limit ?? "10", 10);
      const limit = Math.min(isNaN(rawLimit) ? 10 : Math.max(1, rawLimit), 50);

      const data = await listRecentWorkSessions(app.db, limit);
      return reply.send({ data, count: data.length });
    },
  );

  // POST /:goalId/run — Trigger autonomous execution for a specific goal
  app.post<{
    Params: { goalId: string };
    Body: { userId?: string; createPr?: boolean };
  }>(
    "/:goalId/run",
    { schema: { tags: ["autonomous"] } },
    async (request, reply) => {
      const { goalId } = request.params;
      const { userId, createPr } = request.body ?? {};

      // Validate goal exists
      const goal = await getGoal(app.db, goalId);
      if (!goal) {
        return reply.status(404).send({ error: `Goal not found: ${goalId}` });
      }

      // Enqueue via BullMQ — non-blocking, returns immediately
      const jobId = await enqueueAgentTask({
        goalId,
        prompt: goal.description ?? goal.title,
        userId,
        priority: "normal",
      });

      // Store queueJobId in goal metadata for later status lookup
      await updateGoalMetadata(app.db, goalId, { queueJobId: jobId });

      logger.info({ goalId, jobId, userId, createPr }, "autonomous goal execution enqueued");

      return reply.status(202).send({
        jobId,
        status: "queued",
        goalId,
      });
    },
  );
};
