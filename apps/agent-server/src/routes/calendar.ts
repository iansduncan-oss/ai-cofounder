import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { CalendarService } from "../services/calendar.js";
import { getMeetingPrep, upsertMeetingPrep } from "@ai-cofounder/db";
import { MeetingPrepService } from "../services/meeting-prep.js";

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
  app.post<{ Body: { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[]; timeZone?: string } }>(
    "/events",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { summary, start, end } = request.body ?? {} as Record<string, string>;
        if (!summary || !start || !end) {
          return reply.code(400).send({ error: "Fields 'summary', 'start', and 'end' are required" });
        }
        return await svc.createEvent(request.body);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // PATCH /api/calendar/events/:id
  app.patch<{ Params: { id: string }; Body: { summary?: string; start?: string; end?: string; description?: string; location?: string; attendees?: string[]; timeZone?: string } }>(
    "/events/:id",
    { schema: { tags: ["calendar"] } },
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
  app.post<{ Params: { id: string }; Body: { responseStatus: "accepted" | "declined" | "tentative" } }>(
    "/events/:id/respond",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { responseStatus } = request.body ?? {} as Record<string, string>;
        if (!responseStatus) {
          return reply.code(400).send({ error: "Field 'responseStatus' is required" });
        }
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
  app.post<{ Body: { timeMin: string; timeMax: string } }>(
    "/free-busy",
    { schema: { tags: ["calendar"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { timeMin, timeMax } = request.body ?? {} as Record<string, string>;
        if (!timeMin || !timeMax) {
          return reply.code(400).send({ error: "Fields 'timeMin' and 'timeMax' are required" });
        }
        return await svc.getFreeBusy(timeMin, timeMax);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
