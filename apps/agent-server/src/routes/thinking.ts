import type { FastifyInstance } from "fastify";
import { getThinkingTraces } from "@ai-cofounder/db";

export async function thinkingRoutes(app: FastifyInstance) {
  app.get<{
    Params: { conversationId: string };
    Querystring: { requestId?: string };
  }>("/:conversationId", async (request) => {
    const { conversationId } = request.params;
    const { requestId } = request.query;
    const traces = await getThinkingTraces(app.db, conversationId, requestId);
    return { traces };
  });
}
