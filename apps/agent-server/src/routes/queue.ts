import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import {
  getAllQueueStatus,
  enqueueAgentTask,
  enqueueBriefing,
  enqueueNotification,
  listDeadLetterJobs,
  retryDeadLetterJob,
  deleteDeadLetterJob,
} from "@ai-cofounder/queue";
import {
  EnqueueAgentTaskBody,
  EnqueueBriefingBody,
  EnqueueNotificationBody,
} from "../schemas.js";

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/queue/status — overview of all queues
  app.get("/status", { schema: { tags: ["queue"] } }, async (_request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }
    const status = await getAllQueueStatus();
    return { queues: status };
  });

  // POST /api/queue/agent-task — enqueue an agent task for background execution
  app.post<{ Body: typeof EnqueueAgentTaskBody.static }>(
    "/agent-task",
    { schema: { tags: ["queue"], body: EnqueueAgentTaskBody } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }
      const jobId = await enqueueAgentTask(request.body);
      app.wsBroadcast?.("queue");
      return { jobId, status: "queued" };
    },
  );

  // POST /api/queue/briefing — trigger an on-demand briefing
  app.post<{ Body: typeof EnqueueBriefingBody.static }>(
    "/briefing",
    { schema: { tags: ["queue"], body: EnqueueBriefingBody } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }
      const jobId = await enqueueBriefing({
        type: request.body.type ?? "on_demand",
        deliveryChannels: request.body.deliveryChannels ?? ["slack", "discord"],
      });
      app.wsBroadcast?.("queue");
      return { jobId, status: "queued" };
    },
  );

  // POST /api/queue/notification — send a notification via queue
  app.post<{ Body: typeof EnqueueNotificationBody.static }>(
    "/notification",
    { schema: { tags: ["queue"], body: EnqueueNotificationBody } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }
      const jobId = await enqueueNotification(request.body);
      app.wsBroadcast?.("queue");
      return { jobId, status: "queued" };
    },
  );

  // GET /api/queue/dlq — list dead letter queue jobs
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/dlq",
    { schema: { tags: ["queue"] } },
    async (request, reply) => {
      if (!redisEnabled) {
        return reply.status(503).send({ error: "Queue system not enabled" });
      }
      const limit = parseInt(request.query.limit ?? "50", 10);
      const offset = parseInt(request.query.offset ?? "0", 10);
      const jobs = await listDeadLetterJobs(limit, offset);
      return { jobs, count: jobs.length };
    },
  );

  // POST /api/queue/dlq/:id/retry — retry a dead letter job
  app.post<{ Params: { id: string } }>(
    "/dlq/:id/retry",
    { schema: { tags: ["queue"] } },
    async (request) => {
      return retryDeadLetterJob(request.params.id);
    },
  );

  // DELETE /api/queue/dlq/:id — delete a dead letter job
  app.delete<{ Params: { id: string } }>(
    "/dlq/:id",
    { schema: { tags: ["queue"] } },
    async (request, reply) => {
      await deleteDeadLetterJob(request.params.id);
      return reply.status(204).send();
    },
  );
}
