import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { GmailService } from "../services/gmail.js";

export async function gmailRoutes(app: FastifyInstance): Promise<void> {
  function getService(request: FastifyRequest, reply: FastifyReply): GmailService | null {
    const sub = (request.user as { sub?: string })?.sub;
    if (!sub) {
      // Auth disabled in dev/test — use first admin user fallback
      if (typeof request.jwtVerify !== "function") {
        return new GmailService(app.db, "dashboard-user");
      }
      reply.code(401).send({ error: "Invalid token: missing sub claim" });
      return null;
    }
    return new GmailService(app.db, sub);
  }

  function handleError(err: unknown, reply: FastifyReply) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Google account not connected")) {
      return reply.code(403).send({ error: "Google account not connected" });
    }
    app.log.error({ err }, "Gmail route error");
    return reply.code(500).send({ error: "An internal error occurred" });
  }

  function parseMaxResults(raw?: string): number | undefined {
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(Math.max(1, Math.floor(n)), 50);
  }

  // GET /api/gmail/messages
  app.get<{ Querystring: { maxResults?: string } }>(
    "/messages",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const maxResults = parseMaxResults(request.query.maxResults);
        const messages = await svc.listInbox(maxResults);
        return { messages };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/gmail/messages/:id
  app.get<{ Params: { id: string } }>(
    "/messages/:id",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        return await svc.getMessage(request.params.id);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/gmail/threads/:id
  app.get<{ Params: { id: string } }>(
    "/threads/:id",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        return await svc.getThread(request.params.id);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/gmail/search
  app.get<{ Querystring: { q: string; maxResults?: string } }>(
    "/search",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { q, maxResults } = request.query;
        if (!q) return reply.code(400).send({ error: "Query parameter 'q' is required" });
        const messages = await svc.searchEmails(q, parseMaxResults(maxResults));
        return { messages };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /api/gmail/unread-count
  app.get(
    "/unread-count",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const unreadCount = await svc.getUnreadCount();
        return { unreadCount };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/gmail/drafts
  app.post<{ Body: { to: string; subject: string; body: string; cc?: string; inReplyTo?: string; threadId?: string } }>(
    "/drafts",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { to, subject, body } = request.body ?? {} as Record<string, string>;
        if (!to || !subject || !body) {
          return reply.code(400).send({ error: "Fields 'to', 'subject', and 'body' are required" });
        }
        const result = await svc.createDraft(request.body);
        return { id: result.id, messageId: result.message.id };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/gmail/send
  app.post<{ Body: { to: string; subject: string; body: string; cc?: string; inReplyTo?: string; threadId?: string } }>(
    "/send",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        const { to, subject, body } = request.body ?? {} as Record<string, string>;
        if (!to || !subject || !body) {
          return reply.code(400).send({ error: "Fields 'to', 'subject', and 'body' are required" });
        }
        return await svc.sendEmail(request.body);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/gmail/drafts/:id/send
  app.post<{ Params: { id: string } }>(
    "/drafts/:id/send",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        return await svc.sendDraft(request.params.id);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /api/gmail/messages/:id/read
  app.post<{ Params: { id: string } }>(
    "/messages/:id/read",
    { schema: { tags: ["gmail"] } },
    async (request, reply) => {
      try {
        const svc = getService(request, reply);
        if (!svc) return;
        await svc.markAsRead(request.params.id);
        return { success: true };
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
