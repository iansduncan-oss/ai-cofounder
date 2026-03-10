import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import { createEvent, listEvents, countEvents } from "@ai-cofounder/db";
import { processEvent } from "../events.js";
import { PaginationQuery } from "../schemas.js";

const InboundEventBody = Type.Object({
  source: Type.String({ minLength: 1, maxLength: 100 }),
  type: Type.String({ minLength: 1, maxLength: 100 }),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const eventRoutes: FastifyPluginAsync = async (app) => {
  /* GET / — list events (paginated) */
  app.get<{ Querystring: typeof PaginationQuery.static }>(
    "/",
    { schema: { tags: ["events"], querystring: PaginationQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const [data, total] = await Promise.all([
        listEvents(app.db, { limit, offset }),
        countEvents(app.db),
      ]);
      return { data, total, limit, offset };
    },
  );

  /* POST /inbound — receive an external event */
  app.post<{ Body: typeof InboundEventBody.static }>(
    "/inbound",
    { schema: { tags: ["events"], body: InboundEventBody } },
    async (request, reply) => {
      const { source, type, payload } = request.body;

      const event = await createEvent(app.db, {
        source,
        type,
        payload: payload ?? {},
      });

      // Process asynchronously — don't block the response
      processEvent(
        app.db,
        app.llmRegistry,
        event,
        app.embeddingService,
        app.sandboxService,
        app.workspaceService,
        app.messagingService,
      ).catch((err) => {
        app.log.error({ err, eventId: event.id }, "background event processing failed");
      });

      return reply.status(202).send({
        eventId: event.id,
        status: "accepted",
      });
    },
  );
};
