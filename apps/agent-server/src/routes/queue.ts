import type { FastifyInstance } from "fastify";
import { optionalEnv } from "@ai-cofounder/shared";
import {
  getAllQueueStatus,
  enqueueAgentTask,
  enqueueBriefing,
  enqueueNotification,
} from "@ai-cofounder/queue";

export async function queueRoutes(app: FastifyInstance): Promise<void> {
  const redisEnabled = !!optionalEnv("REDIS_URL", "");

  // GET /api/queue/status — overview of all queues
  app.get("/status", async (_request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }
    const status = await getAllQueueStatus();
    return { queues: status };
  });

  // POST /api/queue/agent-task — enqueue an agent task for background execution
  app.post<{
    Body: {
      goalId: string;
      prompt: string;
      conversationId?: string;
      userId?: string;
      priority?: "critical" | "high" | "normal" | "low";
    };
  }>("/agent-task", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }
    const jobId = await enqueueAgentTask(request.body);
    return { jobId, status: "queued" };
  });

  // POST /api/queue/briefing — trigger an on-demand briefing
  app.post<{
    Body: {
      type?: "morning" | "evening" | "on_demand";
      deliveryChannels?: ("slack" | "discord" | "voice" | "dashboard")[];
    };
  }>("/briefing", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }
    const jobId = await enqueueBriefing({
      type: request.body.type ?? "on_demand",
      deliveryChannels: request.body.deliveryChannels ?? ["slack", "discord"],
    });
    return { jobId, status: "queued" };
  });

  // POST /api/queue/notification — send a notification via queue
  app.post<{
    Body: {
      channel: "slack" | "discord" | "all";
      type: "alert" | "info" | "warning" | "success";
      title: string;
      message: string;
    };
  }>("/notification", async (request, reply) => {
    if (!redisEnabled) {
      return reply.status(503).send({ error: "Queue system not enabled" });
    }
    const jobId = await enqueueNotification(request.body);
    return { jobId, status: "queued" };
  });
}
