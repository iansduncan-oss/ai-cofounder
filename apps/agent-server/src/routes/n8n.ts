import type { FastifyPluginAsync } from "fastify";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";
import { createOrchestrator } from "../helpers/create-orchestrator.js";
import {
  createN8nWorkflow,
  updateN8nWorkflow,
  getN8nWorkflow,
  listN8nWorkflows,
  deleteN8nWorkflow,
  findN8nWorkflowByEvent,
  findOrCreateUser,
  createConversation,
  createMessage,
} from "@ai-cofounder/db";

const logger = createLogger("n8n-routes");

export const n8nRoutes: FastifyPluginAsync = async (app) => {
  /* ── Inbound webhook — n8n → agent ── */

  app.post<{
    Body: {
      event_type?: string;
      message: string;
      userId?: string;
      platform?: string;
      metadata?: Record<string, unknown>;
    };
    Querystring: { sync?: string };
  }>("/webhook", { schema: { tags: ["n8n"] } }, async (request, reply) => {
    const secret = optionalEnv("N8N_SHARED_SECRET", "");
    if (secret) {
      const provided = request.headers["x-n8n-secret"];
      if (provided !== secret) {
        return reply.status(401).send({ error: "Invalid or missing x-n8n-secret header" });
      }
    }

    const { event_type, message, userId, platform, metadata } = request.body ?? {};
    if (!message) {
      return reply.status(400).send({ error: "message is required" });
    }

    // If event_type provided, verify a matching workflow exists
    if (event_type) {
      const workflow = await findN8nWorkflowByEvent(app.db, event_type);
      if (!workflow) {
        logger.warn({ event_type }, "no workflow registered for event type");
      }
    }

    const isSync = request.query.sync === "true";

    // Resolve user if provided
    let dbUserId: string | undefined;
    let convId: string | undefined;
    if (userId) {
      const user = await findOrCreateUser(app.db, userId, platform ?? "n8n");
      dbUserId = user.id;
      const conv = await createConversation(app.db, { userId: user.id, workspaceId: request.workspaceId });
      convId = conv.id;
    }

    const orchestrator = createOrchestrator(app, { workspaceId: request.workspaceId });

    const contextMessage = event_type
      ? `[n8n event: ${event_type}] ${message}`
      : `[n8n webhook] ${message}`;

    if (isSync) {
      const result = await orchestrator.run(contextMessage, convId, undefined, dbUserId);

      if (result.conversationId) {
        await createMessage(app.db, {
          conversationId: result.conversationId,
          role: "user",
          content: contextMessage,
          metadata: { source: "n8n", event_type, ...metadata },
        });
        await createMessage(app.db, {
          conversationId: result.conversationId,
          role: "agent",
          agentRole: "orchestrator",
          content: result.response,
        });
      }

      return result;
    }

    // Async mode — return 202 immediately, process in background
    setImmediate(async () => {
      try {
        const result = await orchestrator.run(contextMessage, convId, undefined, dbUserId);
        if (result.conversationId) {
          await createMessage(app.db, {
            conversationId: result.conversationId,
            role: "user",
            content: contextMessage,
            metadata: { source: "n8n", event_type, ...metadata },
          });
          await createMessage(app.db, {
            conversationId: result.conversationId,
            role: "agent",
            agentRole: "orchestrator",
            content: result.response,
          });
        }
        logger.info({ event_type, conversationId: result.conversationId }, "async n8n webhook processed");
      } catch (err) {
        logger.error({ err, event_type }, "async n8n webhook processing failed");
      }
    });

    return reply.status(202).send({ status: "accepted", message: "Processing in background" });
  });

  /* ── Workflow CRUD ── */

  app.get("/workflows", { schema: { tags: ["n8n"] } }, async (_request, _reply) => {
    const direction = (_request.query as { direction?: string }).direction as
      | "inbound"
      | "outbound"
      | "both"
      | undefined;
    return listN8nWorkflows(app.db, direction);
  });

  app.post<{
    Body: {
      name: string;
      description?: string;
      webhookUrl: string;
      direction?: "inbound" | "outbound" | "both";
      eventType?: string;
      inputSchema?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
  }>("/workflows", { schema: { tags: ["n8n"] } }, async (request, reply) => {
    const { name, description, webhookUrl, direction, eventType, inputSchema, metadata } =
      request.body;
    if (!name || !webhookUrl) {
      return reply.status(400).send({ error: "name and webhookUrl are required" });
    }
    const workflow = await createN8nWorkflow(app.db, {
      name,
      description,
      webhookUrl,
      direction,
      eventType,
      inputSchema,
      metadata,
    });
    return reply.status(201).send(workflow);
  });

  app.get<{ Params: { id: string } }>("/workflows/:id", { schema: { tags: ["n8n"] } }, async (request, reply) => {
    const workflow = await getN8nWorkflow(app.db, request.params.id);
    if (!workflow) return reply.status(404).send({ error: "Workflow not found" });
    return workflow;
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{
      name: string;
      description: string;
      webhookUrl: string;
      direction: "inbound" | "outbound" | "both";
      eventType: string;
      inputSchema: Record<string, unknown>;
      isActive: boolean;
      metadata: Record<string, unknown>;
    }>;
  }>("/workflows/:id", { schema: { tags: ["n8n"] } }, async (request, reply) => {
    const updated = await updateN8nWorkflow(app.db, request.params.id, request.body);
    if (!updated) return reply.status(404).send({ error: "Workflow not found" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/workflows/:id", { schema: { tags: ["n8n"] } }, async (request, reply) => {
    const deleted = await deleteN8nWorkflow(app.db, request.params.id);
    if (!deleted) return reply.status(404).send({ error: "Workflow not found" });
    return { deleted: true };
  });

  /* ── Execution history ── */
  app.get<{ Querystring: { workflowId?: string; status?: string; limit?: string } }>(
    "/executions",
    { schema: { tags: ["n8n"] } },
    async (request) => {
      const { workflowId, status, limit } = request.query;
      const executions = await app.n8nService.listExecutions({
        workflowId,
        status,
        limit: limit ? Number(limit) : undefined,
      });
      return { data: executions };
    },
  );
};
