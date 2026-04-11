import type { FastifyInstance } from "fastify";
import { getThinkingTraces } from "@ai-cofounder/db";

export async function thinkingRoutes(app: FastifyInstance) {
  app.get<{
    Params: { conversationId: string };
    Querystring: { requestId?: string };
  }>(
    "/:conversationId",
    {
      schema: {
        tags: ["thinking"],
        summary: "Get reasoning traces for a conversation",
        description:
          "Returns the `<thinking>` blocks extracted from LLM responses for a given conversation. " +
          "Optionally filter by a specific request ID to get traces for a single completion.",
      },
    },
    async (request) => {
      const { conversationId } = request.params;
      const { requestId } = request.query;
      const traces = await getThinkingTraces(app.db, conversationId, requestId);
      return { traces };
    },
  );
}
