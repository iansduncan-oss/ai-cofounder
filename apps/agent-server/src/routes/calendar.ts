import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { CalendarService } from "../services/calendar.js";
import { getMeetingPrep } from "@ai-cofounder/db";
import { MeetingPrepService } from "../services/meeting-prep.js";

const CreateEventBody = Type.Object({
  summary: Type.String({ minLength: 1 }),
  start: Type.String(),
  end: Type.String(),
  description: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
  attendees: Type.Optional(Type.Array(Type.String())),
  timeZone: Type.Optional(Type.String()),
  recurrence: Type.Optional(Type.Array(Type.String())),
});
type CreateEventBody = Static<typeof CreateEventBody>;

const UpdateEventBody = Type.Object({
  summary: Type.Optional(Type.String()),
  start: Type.Optional(Type.String()),
  end: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  location: Type.Optional(Type.String()),
  attendees: Type.Optional(Type.Array(Type.String())),
  timeZone: Type.Optional(Type.String()),
  recurrence: Type.Optional(Type.Array(Type.String())),
});
type UpdateEventBody = Static<typeof UpdateEventBody>;

const RespondEventBody = Type.Object({
  responseStatus: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("declined"),
    Type.Literal("tentative"),
  ]),
});
type RespondEventBody = Static<typeof RespondEventBody>;

const FreeBusyBody = Type.Object({
  timeMin: Type.String(),
  timeMax: Type.String(),
});
type FreeBusyBody = Static<typeof FreeBusyBody>;

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  function getService(request: FastifyRequest, reply: FastifyReply): CalendarService | null {
    const sub = (request.user as { sub?: string })?.sub;
    if (!sub) {
      if (typeof request.jwtVerify !== "function") {
        return new CalendarService(app.db, "dashboard-user");
      }
      reply.code(401).send({ error: "Invalid token: missing sub claim" });
      return null;
    }
    return new CalendarService(app.db, sub);
  }

  function handleError(err: unknown, reply: FastifyReply) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Google account not connected")) {
      return reply.code(403).send({ error: "Google account not connected" });
    }
    app.log.error({ err }, "Calendar route error");
    return reply.code(500).send({ error: "An internal error occurred" });
  }

  function parseMaxResults(raw?: string): number | undefined {
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(Math.max(1, Math.floor(n)), 50);
  }

  // GET /api/calendar/events
  app.get<{ Querystring: { timeMin?: string; timeMax?: string; maxResults?: string } }>(
    "/events",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { timeMin, timeMax } = request.query;
        const maxResults = parseMaxResults(request.query.maxResults);
        const events = await svc.listEvents({ timeMin, timeMax, maxResults });
        return { events };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/calendar/day-map
  app.get<{ Querystring: { date?: string; timeMin?: string; timeMax?: string } }>(
    "/day-map",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { date, timeMin, timeMax } = request.query;
        return await svc.getDayMap({ date, timeMin, timeMax });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/calendar/events/search — registered before :id to avoid conflicts
  app.get<{ Querystring: { q: string; maxResults?: string } }>(
    "/events/search",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { q, maxResults } = request.query;
        if (!q) return reply.code(400).send({ error: "Query parameter 'q' is required" });
        const events = await svc.searchEvents(q, parseMaxResults(maxResults));
        return { events };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/calendar/events/:id
  app.get<{ Params: { id: string } }>(
    "/events/:id",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        return await svc.getEvent(request.params.id);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/calendar/events
  app.post<{ Body: CreateEventBody }>(
    "/events",
    { schema: { tags: ["calendar"], body: CreateEventBody } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { summary, start, end } = request.body;
        return await svc.createEvent(request.body);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // PATCH /api/calendar/events/:id
  app.patch<{ Params: { id: string }; Body: UpdateEventBody }>(
    "/events/:id",
    { schema: { tags: ["calendar"], body: UpdateEventBody } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        return await svc.updateEvent(request.params.id, request.body);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // DELETE /api/calendar/events/:id
  app.delete<{ Params: { id: string } }>(
    "/events/:id",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        await svc.deleteEvent(request.params.id);
        return { success: true };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/calendar/events/:id/respond
  app.post<{ Params: { id: string }; Body: RespondEventBody }>(
    "/events/:id/respond",
    { schema: { tags: ["calendar"], body: RespondEventBody } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { responseStatus } = request.body;
        const event = await svc.respondToEvent(request.params.id, responseStatus);
        return { success: true, eventId: event.id };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/calendar/events/:id/prep
  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/events/:id/prep",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { id } = request.params;
        const refresh = request.query.refresh === "true";

        // Check for cached prep (unless refresh requested)
        if (!refresh) {
          const cached = await getMeetingPrep(app.db, id);
          if (cached) {
            return {
              eventId: cached.eventId,
              eventTitle: cached.eventTitle,
              prepText: cached.prepText,
              attendees: cached.attendees,
              relatedMemories: cached.relatedMemories,
              generatedAt: cached.generatedAt,
            };
          }
        }

        // Generate on-demand
        const sub = (request.user as { sub?: string })?.sub ?? "dashboard-user";
        const event = await svc.getEvent(id);
        const prepService = new MeetingPrepService(app.db, app.llmRegistry, app.embeddingService);
        await prepService.generatePrepForEvent(
          {
            id: event.id,
            summary: event.summary,
            start: event.start.dateTime ?? event.start.date ?? "",
            end: event.end.dateTime ?? event.end.date ?? "",
            isAllDay: !!event.start.date && !event.start.dateTime,
            status: event.status,
            attendeeCount: event.attendees?.length ?? 0,
            location: event.location,
          },
          sub,
        );

        const prep = await getMeetingPrep(app.db, id);
        if (!prep) return reply.code(500).send({ error: "Failed to generate meeting prep" });

        return {
          eventId: prep.eventId,
          eventTitle: prep.eventTitle,
          prepText: prep.prepText,
          attendees: prep.attendees,
          relatedMemories: prep.relatedMemories,
          generatedAt: prep.generatedAt,
        };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/calendar/free-busy
  app.post<{ Body: FreeBusyBody }>(
    "/free-busy",
    { schema: { tags: ["calendar"], body: FreeBusyBody } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { timeMin, timeMax } = request.body;
        return await svc.getFreeBusy(timeMin, timeMax);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
