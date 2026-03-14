import type { FastifyInstance } from "fastify";
import { createLogger } from "@ai-cofounder/shared";
import { getUserTimezone, setUserTimezone } from "@ai-cofounder/db";
import { ContextualAwarenessService } from "../services/contextual-awareness.js";

const logger = createLogger("context-routes");

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/context/current — full context block
  app.get("/current", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    const userId = query.userId;

    // Resolve per-user timezone if available
    let timezone: string | undefined;
    if (userId) {
      timezone = (await getUserTimezone(app.db, userId)) ?? undefined;
    }

    const service = new ContextualAwarenessService(app.db, { timezone });
    const block = await service.getContextBlock(userId);
    return { data: block };
  });

  // GET /api/context/engagement — session engagement metrics
  app.get("/engagement", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    if (!query.userId) {
      return { data: null };
    }

    if (!app.sessionEngagementService) {
      return { data: null };
    }

    const context = await app.sessionEngagementService.getEngagementContext(query.userId);
    return { data: context };
  });

  // PUT /api/context/timezone — set user timezone
  app.put("/timezone", { schema: { tags: ["context"] } }, async (request, reply) => {
    const body = request.body as { userId: string; timezone: string } | undefined;
    if (!body?.userId || !body?.timezone) {
      return reply.code(400).send({ error: "userId and timezone are required" });
    }

    // Validate timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: body.timezone });
    } catch {
      return reply.code(400).send({ error: `Invalid timezone: ${body.timezone}` });
    }

    await setUserTimezone(app.db, body.userId, body.timezone);
    logger.info({ userId: body.userId, timezone: body.timezone }, "user timezone updated");
    app.agentEvents?.emit("ws:context_change");
    return { status: "updated", timezone: body.timezone };
  });

  // GET /api/context/focus — current work focus
  app.get("/focus", { schema: { tags: ["context"] } }, async (request) => {
    const query = request.query as { userId?: string };
    if (!query.userId) {
      return { data: null };
    }

    let timezone: string | undefined;
    timezone = (await getUserTimezone(app.db, query.userId)) ?? undefined;

    const service = new ContextualAwarenessService(app.db, { timezone });
    const block = await service.getContextBlock(query.userId);
    return { data: block };
  });
}
