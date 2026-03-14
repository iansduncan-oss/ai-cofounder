import type { FastifyInstance } from "fastify";
import { listJournalEntries, getJournalEntry } from "@ai-cofounder/db";
import { JournalListQuery, StandupQuery, IdParams } from "../schemas.js";

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/journal — paginated list with filters
  app.get<{ Querystring: typeof JournalListQuery.static }>(
    "/",
    { schema: { tags: ["journal"], querystring: JournalListQuery } },
    async (request) => {
      const { since, until, goalId, entryType, search, limit, offset } = request.query;
      const result = await listJournalEntries(app.db, {
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
        goalId,
        entryType,
        search,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      return result;
    },
  );

  // GET /api/journal/standup — daily standup summary (register before /:id)
  app.get<{ Querystring: typeof StandupQuery.static }>(
    "/standup",
    { schema: { tags: ["journal"], querystring: StandupQuery } },
    async (request) => {
      const dateStr = request.query.date;
      const date = dateStr ? new Date(dateStr) : new Date();
      return app.journalService.generateStandup(date);
    },
  );

  // GET /api/journal/:id — single entry
  app.get<{ Params: typeof IdParams.static }>(
    "/:id",
    { schema: { tags: ["journal"], params: IdParams } },
    async (request, reply) => {
      const entry = await getJournalEntry(app.db, request.params.id);
      if (!entry) {
        return reply.status(404).send({ error: "Journal entry not found" });
      }
      return entry;
    },
  );
}
