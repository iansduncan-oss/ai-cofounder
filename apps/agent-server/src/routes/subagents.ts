import type { FastifyInstance } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import {
  createSubagentRun,
  getSubagentRun,
  listSubagentRuns,
  updateSubagentRunStatus,
} from "@ai-cofounder/db";
import { enqueueSubagentTask, subagentChannel, type SubagentProgressEvent } from "@ai-cofounder/queue";

const logger = createLogger("subagent-routes");

export async function subagentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/subagents — spawn a subagent directly
  app.post<{
    Body: {
      title: string;
      instruction: string;
      conversationId?: string;
      goalId?: string;
      userId?: string;
      priority?: "critical" | "high" | "normal" | "low";
    };
  }>("/", { schema: { tags: ["subagents"] } }, async (request, reply) => {
    const { title, instruction, conversationId, goalId, userId, priority } = request.body;

    const run = await createSubagentRun(app.db, {
      title,
      instruction,
      conversationId,
      goalId,
      userId,
    });

    await enqueueSubagentTask({
      subagentRunId: run.id,
      title,
      instruction,
      conversationId,
      goalId,
      userId,
      priority,
    });

    logger.info({ subagentRunId: run.id, title }, "Subagent spawned via API");

    return reply.status(202).send({
      subagentRunId: run.id,
      status: "queued",
      title,
    });
  });

  // GET /api/subagents/:id — get run status + output
  app.get<{ Params: { id: string } }>(
    "/:id",
    { schema: { tags: ["subagents"] } },
    async (request, reply) => {
      const run = await getSubagentRun(app.db, request.params.id);
      if (!run) return reply.status(404).send({ error: "Subagent run not found" });
      return run;
    },
  );

  // GET /api/subagents — list runs (paginated, filterable)
  app.get<{
    Querystring: {
      goalId?: string;
      status?: string;
      parentRequestId?: string;
      limit?: string;
      offset?: string;
    };
  }>("/", { schema: { tags: ["subagents"] } }, async (request) => {
    const { goalId, status, parentRequestId, limit, offset } = request.query;
    const result = await listSubagentRuns(app.db, {
      goalId,
      status,
      parentRequestId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return result;
  });

  // GET /api/subagents/:id/stream — SSE progress stream
  app.get<{ Params: { id: string } }>(
    "/:id/stream",
    { schema: { tags: ["subagents"] } },
    async (request, reply) => {
      const subagentRunId = request.params.id;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (data: unknown): void => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Replay history
      const history = await app.redisPubSub.getSubagentHistory(subagentRunId);
      for (const event of history) {
        send(event);
        if (event.type === "subagent_completed" || event.type === "subagent_failed") {
          reply.raw.end();
          return;
        }
      }

      // Subscribe to live events
      const channel = subagentChannel(subagentRunId);
      let cleanedUp = false;

      const onMessage = (rawMessage: string): void => {
        try {
          const event = JSON.parse(rawMessage) as SubagentProgressEvent;
          send(event);
          if (event.type === "subagent_completed" || event.type === "subagent_failed") {
            cleanup();
          }
        } catch (err) {
          logger.warn({ subagentRunId, err }, "failed to parse subagent event");
        }
      };

      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        app.agentEvents.off(channel, onMessage);
        app.unsubscribeSubagent(subagentRunId).catch(() => {});
        if (!reply.raw.writableEnded) reply.raw.end();
      };

      await app.subscribeSubagent(subagentRunId);
      app.agentEvents.on(channel, onMessage);
      reply.raw.on("close", cleanup);

      logger.info({ subagentRunId, historyCount: history.length }, "SSE client connected for subagent");
    },
  );

  // POST /api/subagents/:id/cancel — cancel a running subagent
  app.post<{ Params: { id: string } }>(
    "/:id/cancel",
    { schema: { tags: ["subagents"] } },
    async (request, reply) => {
      const run = await getSubagentRun(app.db, request.params.id);
      if (!run) return reply.status(404).send({ error: "Subagent run not found" });

      if (run.status !== "queued" && run.status !== "running") {
        return reply.status(400).send({ error: `Cannot cancel subagent in ${run.status} state` });
      }

      await updateSubagentRunStatus(app.db, request.params.id, { status: "cancelled" });
      return { subagentRunId: run.id, status: "cancelled" };
    },
  );
}
