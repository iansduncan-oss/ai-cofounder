import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import { createEvent, listEvents, countEvents, getEventById, resetEventProcessed } from "@ai-cofounder/db";
import { optionalEnv, createLogger } from "@ai-cofounder/shared";
import { processEvent } from "../events.js";
import { PaginationQuery, IdParams } from "../schemas.js";

const logger = createLogger("event-routes");

const InboundEventBody = Type.Object({
  source: Type.String({ minLength: 1, maxLength: 100 }),
  type: Type.String({ minLength: 1, maxLength: 100 }),
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { maxProperties: 20 })),
});

const EventListQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    source: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    processed: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
  }),
]);

export const eventRoutes: FastifyPluginAsync = async (app) => {
  // Warn at startup if ALLOWED_EVENT_SOURCES is not configured in production
  if (process.env.NODE_ENV === "production" && !optionalEnv("ALLOWED_EVENT_SOURCES", "")) {
    logger.warn("ALLOWED_EVENT_SOURCES is not configured — inbound events will be rejected in production");
  }

  /* GET / — list events (paginated, filterable) */
  app.get<{ Querystring: typeof EventListQuery.static }>(
    "/",
    { schema: { tags: ["events"], querystring: EventListQuery } },
    async (request) => {
      const limit = Math.min(request.query.limit ?? 50, 200);
      const offset = request.query.offset ?? 0;
      const filters = {
        limit,
        offset,
        source: request.query.source,
        type: request.query.type,
        processed: request.query.processed != null ? request.query.processed === "true" : undefined,
      };
      const [data, total] = await Promise.all([
        listEvents(app.db, filters),
        countEvents(app.db, filters),
      ]);
      return { data, total, limit, offset };
    },
  );

  /* POST /:id/reprocess — re-trigger event processing */
  app.post<{ Params: typeof IdParams.static }>(
    "/:id/reprocess",
    { schema: { tags: ["events"], params: IdParams } },
    async (request, reply) => {
      const event = await getEventById(app.db, request.params.id);
      if (!event) {
        return reply.status(404).send({ error: "Event not found" });
      }

      // Reset processed state
      await resetEventProcessed(app.db, event.id);

      // Re-trigger processing in the background
      processEvent(
        app.db,
        app.llmRegistry,
        event,
        app.embeddingService,
        app.sandboxService,
        app.workspaceService,
        app.messagingService,
      ).catch((err) => {
        app.log.error({ err, eventId: event.id }, "reprocess event failed");
      });

      return reply.status(202).send({ eventId: event.id, status: "reprocessing" });
    },
  );

  /* POST /inbound — receive an external event */
  app.post<{ Body: typeof InboundEventBody.static }>(
    "/inbound",
    {
      schema: { tags: ["events"], body: InboundEventBody },
      preHandler: async (request, reply) => {
        // Accept API_SECRET bearer token as an alternative to JWT for webhook callers
        const apiSecret = optionalEnv("API_SECRET", "");
        if (apiSecret) {
          const authHeader = request.headers.authorization;
          if (authHeader === `Bearer ${apiSecret}`) {
            return; // Authenticated via API_SECRET
          }
        }

        // If JWT already verified (handled by jwt-guard), allow through
        // jwtVerify would have already run in the parent scope's onRequest hook
        // Loopback/Docker callers are also already allowed through by jwt-guard

        // No additional auth block here — jwt-guard handles the gate.
        // This preHandler just adds the API_SECRET alternative path.
      },
    },
    async (request, reply) => {
      const { source, type, payload } = request.body;

      // Require ALLOWED_EVENT_SOURCES in production
      const allowedSources = optionalEnv("ALLOWED_EVENT_SOURCES", "").split(",").filter(Boolean);
      if (process.env.NODE_ENV === "production" && allowedSources.length === 0) {
        return reply.status(503).send({ error: "Event source whitelist not configured" });
      }
      if (allowedSources.length > 0 && !allowedSources.includes(source)) {
        return reply.status(403).send({ error: "Source not allowed" });
      }

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
