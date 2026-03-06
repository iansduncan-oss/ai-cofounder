import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import { createEvent } from "@ai-cofounder/db";
import { processEvent } from "../events.js";

const InboundEventBody = Type.Object({
  source: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const eventRoutes: FastifyPluginAsync = async (app) => {
  /* POST /inbound — receive an external event */
  app.post<{ Body: typeof InboundEventBody.static }>(
    "/inbound",
    { schema: { body: InboundEventBody } },
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
